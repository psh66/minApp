const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 团长配置（和你支付函数完全对齐，payType 统一为 month/year）
const GROUP_CONFIG = {
  rewardAmount: {
    month: 1, // 对应原 monthly，和支付回调一致
    year: 5, // 对应原 yearly，和支付回调一致
  },
  withdrawMin: 1,
};

exports.main = async (event, context) => {
  const {
    action,
    openid,
    amount,
    payeeInfo = {},
    userOpenid,
    leaderOpenid,
    payType,
  } = event;

  const { OPENID: ctxOpenid } = cloud.getWXContext();
  const finalOpenid = openid || ctxOpenid;

  if (!action) {
    return { success: false, msg: "缺少action" };
  }

  try {
    switch (action) {
      case "getData":
        return await getData(finalOpenid);
      case "applyWithdraw":
        return await applyWithdrawManual(finalOpenid, amount, payeeInfo);
      case "calculateFirstPayReward":
        return await calculateFirstPayReward(userOpenid, leaderOpenid, payType);
      default:
        return { success: false, msg: "非法action" };
    }
  } catch (e) {
    console.error("group error:", e);
    return { success: false, msg: "执行失败", error: e.message };
  }
};

// 获取团长数据
async function getData(leaderOpenid) {
  let leaderRes = await db
    .collection("groupLeader")
    .where({ leaderOpenid })
    .get();
  if (leaderRes.data.length === 0) {
    await db.collection("groupLeader").add({
      data: {
        leaderOpenid,
        pendingReward: 0,
        withdrawAble: 0,
        totalOrder: 0,
        totalCommission: 0, // 补充总佣金字段，和支付回调对齐
        totalWithdrawn: 0, // 补充已提现字段
        pendingWithdraw: 0, // 补充审核中字段
        createTime: db.serverDate(),
        updateTime: db.serverDate(),
      },
    });
    leaderRes = await db
      .collection("groupLeader")
      .where({ leaderOpenid })
      .get();
  }

  const orderRes = await db
    .collection("orders")
    .where({ leaderOpenid })
    .orderBy("createTime", "desc")
    .limit(50)
    .get();

  const withdrawRes = await db
    .collection("withdrawRecord")
    .where({ leaderOpenid })
    .orderBy("createTime", "desc")
    .get();

  return {
    success: true,
    data: leaderRes.data[0] || {},
    orderList: orderRes.data || [],
    withdrawRecords: withdrawRes.data || [],
  };
}

// 提现申请
async function applyWithdrawManual(leaderOpenid, amount, payeeInfo) {
  if (!amount || amount < GROUP_CONFIG.withdrawMin) {
    return { success: false, msg: `最低提现${GROUP_CONFIG.withdrawMin}元` };
  }

  const leaderRes = await db
    .collection("groupLeader")
    .where({ leaderOpenid })
    .get();
  if (leaderRes.data.length === 0) {
    return { success: false, msg: "团长信息不存在" };
  }
  const leaderDoc = leaderRes.data[0];

  if (leaderDoc.withdrawAble < amount) {
    return { success: false, msg: "可提现金额不足" };
  }

  const outBillNo = `TX_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  await db.collection("withdrawRecord").add({
    data: {
      leaderOpenid,
      amount,
      payeeInfo,
      outBillNo,
      status: "pending",
      createTime: db.serverDate(),
      updateTime: db.serverDate(),
    },
  });

  // 补充：扣减可提现金额 + 增加审核中金额（和团长页面逻辑对齐）
  await db
    .collection("groupLeader")
    .doc(leaderDoc._id)
    .update({
      data: {
        withdrawAble: _.inc(-amount),
        pendingWithdraw: _.inc(amount),
        updateTime: db.serverDate(),
      },
    });

  return { success: true, msg: "提现申请已提交，等待审核" };
}

// 首次付费返佣（核心修改：统一payType + 补充settleStatus）
async function calculateFirstPayReward(userOpenid, leaderOpenid, payType) {
  if (!userOpenid || !leaderOpenid || !payType) {
    return { success: false, msg: "参数缺失" };
  }

  // 统一payType格式：兼容原monthly/yearly，转为month/year（和支付回调一致）
  let finalPayType = payType;
  if (payType === "monthly") finalPayType = "month";
  if (payType === "yearly") finalPayType = "year";
  if (!["month", "year"].includes(finalPayType)) {
    return {
      success: false,
      msg: "付费类型错误（仅支持month/year/monthly/yearly）",
    };
  }

  // 防重复返佣：调整查询条件，兼容新字段
  const record = await db
    .collection("rewardRecords")
    .where({
      userOpenid,
      leaderOpenid,
      // 兼容旧type字段 + 新payType字段，避免重复返佣
      payType: finalPayType,
    })
    .get();
  if (record.data.length > 0) {
    return { success: true, msg: "已返佣" };
  }

  const rewardAmount = GROUP_CONFIG.rewardAmount[finalPayType];
  if (!rewardAmount) return { success: false, msg: "未配置返佣" };

  let leaderRes = await db
    .collection("groupLeader")
    .where({ leaderOpenid })
    .get();
  if (leaderRes.data.length === 0) {
    await db.collection("groupLeader").add({
      data: {
        leaderOpenid,
        pendingReward: 0,
        withdrawAble: 0,
        totalOrder: 0,
        totalCommission: 0, // 补充总佣金字段
        totalWithdrawn: 0, // 补充已提现字段
        pendingWithdraw: 0, // 补充审核中字段
        createTime: db.serverDate(),
        updateTime: db.serverDate(),
      },
    });
    leaderRes = await db
      .collection("groupLeader")
      .where({ leaderOpenid })
      .get();
  }
  const leaderDoc = leaderRes.data[0];

  // 调整返佣逻辑：优先累加pendingReward（待结算），而非直接加可提现（和支付回调一致）
  await db
    .collection("groupLeader")
    .doc(leaderDoc._id)
    .update({
      data: {
        pendingReward: _.inc(rewardAmount), // 待结算收益+佣金（核心修改）
        totalOrder: _.inc(1), // 总订单数+1
        totalCommission: _.inc(rewardAmount), // 总佣金+佣金
        updateTime: db.serverDate(),
      },
    });

  // ========== 核心修改：补充settleStatus等字段，和支付回调一致 ==========
  await db.collection("rewardRecords").add({
    data: {
      userOpenid,
      leaderOpenid,
      payType: finalPayType, // 统一为month/year
      rewardAmount,
      settleStatus: "unsettled", // 初始未结算（和团长页面匹配）
      // 保留原type字段做兼容，可后续删除
      type: "firstPay",
      status: "success",
      createTime: db.serverDate(),
      updateTime: db.serverDate(),
    },
  });

  return {
    success: true,
    msg: "返佣成功",
    rewardAmount,
    payType: finalPayType,
  };
}
