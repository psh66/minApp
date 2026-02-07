const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 团长配置（和payCallback里的payType完全对齐：month/year）
const GROUP_CONFIG = {
  rewardAmount: {
    month: 1,  // 月付返佣1元
    year: 5    // 年付返佣5元
  },
  withdrawMin: 1 // 最低提现1元
};

exports.main = async (event, context) => {
  // 解构参数+默认值（兼容各种传参场景）
  const { 
    action, 
    openid, 
    amount, 
    payeeInfo = {}, 
    userOpenid, 
    leaderOpenid, 
    payType 
  } = event;
  
  const { OPENID: ctxOpenid } = cloud.getWXContext();
  // 优先用传参openid，无则用上下文openid（容错）
  const finalOpenid = openid || ctxOpenid;

  // 基础参数校验
  if (!action) {
    return { success: false, msg: "缺少操作类型action" };
  }

  try {
    // 按action分发业务逻辑
    switch (action) {
      case "getData":
        return await getData(finalOpenid);
      case "applyWithdraw":
        return await applyWithdrawManual(finalOpenid, amount, payeeInfo);
      case "calculateFirstPayReward":
        return await calculateFirstPayReward(userOpenid, leaderOpenid, payType);
      default:
        return { 
          success: false, 
          msg: `非法操作类型：${action}（仅支持getData/applyWithdraw/calculateFirstPayReward）` 
        };
    }
  } catch (e) {
    console.error("groupLeader函数执行失败：", e);
    return { 
      success: false, 
      msg: "函数执行失败", 
      error: e.message 
    };
  }
};

// ========== 核心函数1：获取团长全量数据（含rewardRecords） ==========
async function getData(leaderOpenid) {
  // 1. 查询/初始化团长基础信息
  let leaderRes = await db.collection("groupLeader").where({ leaderOpenid }).get();
  if (leaderRes.data.length === 0) {
    // 初始化空团长数据
    await db.collection("groupLeader").add({
      data: {
        leaderOpenid,
        pendingReward: 0,
        withdrawAble: 0,
        totalOrder: 0,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    });
    // 重新查询确保数据存在
    leaderRes = await db.collection("groupLeader").where({ leaderOpenid }).get();
  }

  // 2. 查询团长关联数据（分页+倒序，提升性能）
  // 推广订单列表
  const orderRes = await db
    .collection("orders")
    .where({ leaderOpenid })
    .orderBy("createTime", "desc")
    .limit(50)
    .get();
  // 提现记录
  const withdrawRes = await db
    .collection("withdrawRecord")
    .where({ leaderOpenid })
    .orderBy("createTime", "desc")
    .get();
  // 佣金记录（关键：新增返回rewardRecords）
  const rewardRes = await db
    .collection("rewardRecords")
    .where({ leaderOpenid })
    .orderBy("createTime", "desc")
    .get();

  // 3. 组装返回数据（对齐前端页面需求）
  return {
    success: true,
    data: leaderRes.data[0] || {},
    orderList: orderRes.data || [],
    withdrawRecords: withdrawRes.data || [],
    rewardRecords: rewardRes.data || [] // 前端页面需要的佣金记录
  };
}

// ========== 核心函数2：手动提现申请 ==========
async function applyWithdrawManual(leaderOpenid, amount, payeeInfo) {
  // 1. 提现金额校验
  if (!amount || amount < GROUP_CONFIG.withdrawMin) {
    return { success: false, msg: `最低提现${GROUP_CONFIG.withdrawMin}元` };
  }

  // 2. 查询团长信息
  const leaderRes = await db.collection("groupLeader").where({ leaderOpenid }).get();
  if (leaderRes.data.length === 0) {
    return { success: false, msg: "团长信息不存在" };
  }
  const leaderDoc = leaderRes.data[0];

  // 3. 可提现金额校验
  if (leaderDoc.withdrawAble < amount) {
    return { success: false, msg: "可提现金额不足" };
  }

  // 4. 生成唯一提现订单号
  const outBillNo = `TX_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  // 5. 写入提现记录
  await db.collection("withdrawRecord").add({
    data: {
      leaderOpenid,
      amount,
      payeeInfo: {
        wechatName: payeeInfo.wechatName?.trim() || "",
        wechatNo: payeeInfo.wechatNo?.trim() || ""
      },
      outBillNo,
      status: "pending", // 待审核
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    }
  });

  // 6. 返回结果
  return { 
    success: true, 
    msg: "提现申请已提交，等待审核", 
    outBillNo 
  };
}

// ========== 核心函数3：首次付费返佣（新用户校验+防重复） ==========
async function calculateFirstPayReward(userOpenid, leaderOpenid, payType) {
  // 1. 基础参数校验
  if (!userOpenid || !leaderOpenid || !payType) {
    return { 
      success: false, 
      msg: "参数缺失（userOpenid/leaderOpenid/payType不能为空）" 
    };
  }
  if (!["month", "year"].includes(payType)) {
    return { 
      success: false, 
      msg: "付费类型错误（仅支持month/year）" 
    };
  }

  // 2. 核心校验：是否为从未付费的新用户
  const userPayOrderCount = await db
    .collection("orders")
    .where({
      openid: userOpenid,  // 对齐订单表的openid字段
      status: "paid"       // 仅统计支付成功的订单
    })
    .count();

  // 老用户（有历史付费记录）→ 不返佣
  if (userPayOrderCount.total > 0) {
    return {
      success: true,
      msg: "该用户是老付费用户（有历史付款记录），非新用户，不发放佣金"
    };
  }

  // 3. 防重复返佣校验
  const rewardRecordRes = await db.collection("rewardRecords")
    .where({
      userOpenid,
      leaderOpenid,
      type: "firstPay"
    })
    .get();
  if (rewardRecordRes.data.length > 0) {
    return { 
      success: true, 
      msg: "该用户已返佣，无需重复计算" 
    };
  }

  // 4. 获取返佣金额
  const rewardAmount = GROUP_CONFIG.rewardAmount[payType];
  if (!rewardAmount) {
    return { 
      success: false, 
      msg: `未配置${payType}类型的返佣金额` 
    };
  }

  // 5. 查询/初始化团长信息
  let leaderRes = await db.collection("groupLeader").where({ leaderOpenid }).get();
  if (leaderRes.data.length === 0) {
    await db.collection("groupLeader").add({
      data: {
        leaderOpenid,
        pendingReward: 0,
        withdrawAble: 0,
        totalOrder: 0,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    });
    leaderRes = await db.collection("groupLeader").where({ leaderOpenid }).get();
  }
  const leaderDoc = leaderRes.data[0];

  // 6. 更新团长可提现金额
  await db.collection("groupLeader").doc(leaderDoc._id).update({
    data: {
      withdrawAble: leaderDoc.withdrawAble + rewardAmount,
      totalOrder: leaderDoc.totalOrder + 1,
      updateTime: db.serverDate()
    }
  });

  // 7. 记录佣金流水
  await db.collection("rewardRecords").add({
    data: {
      userOpenid,
      leaderOpenid,
      payType,
      rewardAmount,
      type: "firstPay",
      status: "success",
      createTime: db.serverDate()
    }
  });

  // 8. 返回返佣结果
  return {
    success: true,
    msg: `返佣成功，团长${leaderOpenid}新增可提现金额${rewardAmount}元`,
    rewardAmount
  };
}