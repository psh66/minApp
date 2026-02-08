const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { action, openid, amount, payeeInfo } = event;

  if (action === 'getData') {
    try {
      let data = { withdrawAble: 0, totalOrder: 0, pendingReward: 0 };
      try {
        const res = await db.collection('groupLeader').doc(openid).get();
        if (res.data) data = res.data;
      } catch (e) {}

      const rewardRecords = await db.collection('rewardRecords')
        .where({ leaderOpenid: openid })
        .orderBy('createTime', 'desc')
        .get();

      const withdrawRecords = await db.collection('withdrawRecords')
        .where({ leaderOpenid: openid })
        .orderBy('createTime', 'desc')
        .get();

      return {
        success: true,
        data,
        rewardRecords: rewardRecords.data || [],
        withdrawRecords: withdrawRecords.data || []
      };
    } catch (err) {
      return { success: false, msg: '获取失败', err };
    }
  }

  if (action === 'applyWithdraw') {
    try {
      const leaderRes = await db.collection('groupLeader').doc(openid).get();
      if (!leaderRes.data) return { success: false, msg: '未找到团长信息' };

      const available = leaderRes.data.withdrawAble || 0;
      if (amount < 1 || amount > available) return { success: false, msg: '金额不合法' };

      // 新增提现记录（含收款码fileID）
      await db.collection('withdrawRecords').add({
        data: {
          leaderOpenid: openid,
          amount,
          status: 'pending',
          payeeInfo,
          createTime: db.serverDate()
        }
      });

      // 扣减可提现
      await db.collection('groupLeader').doc(openid).update({
        data: { withdrawAble: available - amount }
      });

      return { success: true, msg: '申请成功' };
    } catch (err) {
      return { success: false, msg: '申请失败', err };
    }
  }

  return { success: false, msg: '非法action' };
};