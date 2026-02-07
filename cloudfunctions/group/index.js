const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 团长配置（和你支付函数完全对齐）
const GROUP_CONFIG = {
  rewardAmount: {
    monthly: 1,
    yearly: 5
  },
  withdrawMin: 1
};

exports.main = async (event, context) => {
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
    withdrawRecords: withdrawRes.data || []
  };
}

// 提现申请
async function applyWithdrawManual(leaderOpenid, amount, payeeInfo) {
  if (!amount || amount < GROUP_CONFIG.withdrawMin) {
    return { success: false, msg: `最低提现${GROUP_CONFIG.withdrawMin}元` };
  }

  const leaderRes = await db.collection("groupLeader").where({ leaderOpenid }).get();
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
      updateTime: db.serverDate()
    }
  });

  return { success: true, msg: "提现申请已提交，等待审核" };
}

// 首次付费返佣
async function calculateFirstPayReward(userOpenid, leaderOpenid, payType) {
  if (!userOpenid || !leaderOpenid || !payType) {
    return { success: false, msg: "参数缺失" };
  }
  if (!["monthly", "yearly"].includes(payType)) {
    return { success: false, msg: "付费类型错误" };
  }

  const record = await db.collection("rewardRecords")
    .where({ userOpenid, leaderOpenid, type: "firstPay" })
    .get();
  if (record.data.length > 0) {
    return { success: true, msg: "已返佣" };
  }

  const rewardAmount = GROUP_CONFIG.rewardAmount[payType];
  if (!rewardAmount) return { success: false, msg: "未配置返佣" };

  let leaderRes = await db.collection("groupLeader").where({ leaderOpenid }).get();
  if (leaderRes.data.length === 0) {
    await db.collection("groupLeader").add({
      data: {
        leaderOpenid, pendingReward:0, withdrawAble:0, totalOrder:0,
        createTime: db.serverDate(), updateTime: db.serverDate()
      }
    });
    leaderRes = await db.collection("groupLeader").where({ leaderOpenid }).get();
  }
  const leaderDoc = leaderRes.data[0];

  await db.collection("groupLeader").doc(leaderDoc._id).update({
    data: {
      withdrawAble: leaderDoc.withdrawAble + rewardAmount,
      totalOrder: leaderDoc.totalOrder + 1,
      updateTime: db.serverDate()
    }
  });

  await db.collection("rewardRecords").add({
    data: {
      userOpenid, leaderOpenid, payType, rewardAmount,
      type: "firstPay", status: "success", createTime: db.serverDate()
    }
  });

  return { success: true, msg: "返佣成功", rewardAmount };
}