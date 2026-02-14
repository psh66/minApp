const cloud = require("wx-server-sdk");
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  console.log("===== payCallback 开始执行 =====");
  const payEvent = event["cloud-pay"] || event;
  const { resultCode, outTradeNo } = payEvent;

  if (resultCode !== "SUCCESS") {
    console.log("支付未成功，返回失败");
    return { errcode: -1, errmsg: "payment not success" };
  }

  try {
    // 1. 查询订单
    const orderRes = await db
      .collection("orders")
      .where({ orderNo: outTradeNo })
      .get();
    if (orderRes.data.length === 0) {
      console.error("订单未找到：", outTradeNo);
      return { errcode: -1, errmsg: "order not found" };
    }

    const order = orderRes.data[0];
    // 核心：订单已支付 或 已标记发佣 → 直接跳过，避免重复发佣
    if (order.status === "paid" || order.hasCommission) {
      console.log("订单已处理/已发佣，跳过：", outTradeNo);
      return { errcode: 0, errmsg: "already handled" };
    }

    const { openid, payType, leaderOpenid } = order;

    // 2. 会员时长逻辑（保留原样）
    const serviceDays = payType === "month" ? 30 : 365;
    const userRes = await db
      .collection("users")
      .where({ _openid: openid })
      .get();
    const now = new Date();
    let serviceEndTime;

    if (userRes.data.length > 0 && userRes.data[0].serviceEndTime) {
      const oldEnd = new Date(userRes.data[0].serviceEndTime);
      serviceEndTime =
        oldEnd > now
          ? new Date(oldEnd.setDate(oldEnd.getDate() + serviceDays))
          : new Date(now.setDate(now.getDate() + serviceDays));
    } else {
      serviceEndTime = new Date(now.setDate(now.getDate() + serviceDays));
    }

    // 3. 更新订单为已支付
    await db
      .collection("orders")
      .doc(order._id)
      .update({
        data: { status: "paid", payTime: db.serverDate() },
      });

    // 4. 更新用户会员信息
    await db
      .collection("users")
      .where({ _openid: openid })
      .update({
        data: {
          isFormalVersion: true,
          serviceEndTime: serviceEndTime.toISOString().split("T")[0],
          payType,
          lastPayTime: db.serverDate(),
        },
      });

    // ==================== 团长佣金逻辑（修正核心） ====================
    // 无团长 / 自购 → 标记订单已发佣（避免重复处理），不发佣
    if (!leaderOpenid || leaderOpenid === openid) {
      console.log("无推广人 或 自购，不发佣");
      await db
        .collection("orders")
        .doc(order._id)
        .update({
          data: { hasCommission: true }, // 订单标记：已处理（无佣）
        });
      return { errcode: 0, errmsg: "no leader or self buy" };
    }

    // 判断：是否真正第一次付款（只给新用户发）
    const paidCountRes = await db
      .collection("orders")
      .where({
        openid: openid,
        status: "paid",
        hasCommission: true, // 只查已处理过的订单，排除当前订单
      })
      .count();

    // 老用户/续费 → 标记订单已发佣，不发佣
    if (paidCountRes.total > 0) {
      console.log("用户不是首次付款，老用户/续费，不发放佣金");
      await db
        .collection("orders")
        .doc(order._id)
        .update({
          data: { hasCommission: true }, // 订单标记：已处理（无佣）
        });
      return { errcode: 0, errmsg: "not first payment" };
    }

    // 纯新用户首次付款 → 发佣金
    console.log("纯新用户首次付款，发放团长佣金");
    const commission = payType === "month" ? 1 : 5;

    // 1. 写入推广佣金记录（rewardRecords）→ 补充 settleStatus 字段
    await db.collection("rewardRecords").add({
      data: {
        userOpenid: openid,
        leaderOpenid: leaderOpenid,
        payType: payType,
        rewardAmount: commission,
        orderNo: outTradeNo, // 关联订单号，方便排查
        settleStatus: "unsettled", // 核心补充：初始未结算（和团长页面匹配）
        createTime: db.serverDate(),
        updateTime: db.serverDate(),
      },
    });

    // 2. 更新团长数据：累加，不覆盖（补充 totalCommission 字段，用于团长页面计算）
    const leaderRes = await db
      .collection("groupLeader")
      .where({ leaderOpenid: leaderOpenid })
      .get();

    if (leaderRes.data.length > 0) {
      // 已有记录 → 累加待结算收益、订单数、总佣金
      await db
        .collection("groupLeader")
        .doc(leaderRes.data[0]._id)
        .update({
          data: {
            pendingReward: _.inc(commission), // 待结算收益+佣金
            totalOrder: _.inc(1), // 总订单数+1
            totalCommission: _.inc(commission), // 补充：总佣金累加（团长页面计算用）
            updateTime: db.serverDate(),
          },
        });
    } else {
      // 无记录 → 创建新记录（补充 totalCommission 字段）
      await db.collection("groupLeader").add({
        data: {
          leaderOpenid: leaderOpenid,
          pendingReward: commission, // 初始待结算收益
          withdrawAble: 0, // 可提现金额初始为0
          totalOrder: 1, // 初始订单数
          totalCommission: commission, // 补充：总佣金初始值
          totalWithdrawn: 0, // 已提现金额初始为0
          pendingWithdraw: 0, // 审核中金额初始为0
          createTime: db.serverDate(),
          updateTime: db.serverDate(),
        },
      });
    }

    // 3. 标记订单已发佣（关键：只标记订单表，不标记推广记录）
    await db
      .collection("orders")
      .doc(order._id)
      .update({
        data: { hasCommission: true }, // 订单标记：已发佣
      });

    console.log("===== 佣金发放完成，流程正常结束 =====");
    return { errcode: 0, errmsg: "success" };
  } catch (err) {
    console.error("payCallback 执行异常：", err);
    return {
      errcode: -1,
      errmsg: "error",
      detail: err.message || err.toString(),
    };
  }
};
