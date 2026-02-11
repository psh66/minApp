const cloud = require("wx-server-sdk");
cloud.init();
const db = cloud.database();

exports.main = async (event, context) => {
  const { action, openid } = event;

  // 数据获取 - 无条件全表查询，绝对不拦截
  if (action === "getData") {
    try {
      // 团长信息
      let leaderData = { withdrawAble: 0, totalOrder: 0, pendingReward: 0 };
      try {
        let d = await db.collection("groupLeader").doc(openid).get();
        if (d.data) leaderData = d.data;
      } catch (e) {}

      // ====================== 无条件全表查询，不加任何where ======================
      // 推广记录 - 直接读全表
      const reward = await db.collection("rewardRecords").get();

      // 提现记录 - 直接读全表
      const withdraw = await db.collection("withdrawRecords").get();

      // 强制打印真实条数，你在云开发控制台能看到
      console.log("推广记录条数：", reward.data?.length || 0);
      console.log("提现记录条数：", withdraw.data?.length || 0);

      return {
        success: true,
        data: leaderData,
        rewardRecords: reward.data || [],
        withdrawRecords: withdraw.data || [],
      };
    } catch (err) {
      console.error(err);
      return {
        success: true,
        data: { withdrawAble: 0, totalOrder: 0, pendingReward: 0 },
        rewardRecords: [],
        withdrawRecords: [],
      };
    }
  }

  // 提现申请，完全不动
  if (action === "applyWithdraw") {
    try {
      const { openid, amount, payeeInfo } = event;
      const leader = await db.collection("groupLeader").doc(openid).get();
      if (!leader.data) return { success: false, msg: "无团长信息" };

      const can = leader.data.withdrawAble || 0;
      if (amount < 1 || amount > can)
        return { success: false, msg: "金额错误" };

      await db.collection("withdrawRecords").add({
        data: {
          leaderOpenid: openid,
          amount: amount,
          status: "pending",
          payeeInfo: payeeInfo,
          createTime: db.serverDate(),
        },
      });

      await db
        .collection("groupLeader")
        .doc(openid)
        .update({
          data: { withdrawAble: can - amount },
        });

      return { success: true, msg: "申请成功" };
    } catch (e) {
      return { success: false, msg: "提现失败" };
    }
  }

  return { success: false, msg: "无效操作" };
};
