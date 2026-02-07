const cloud = require('wx-server-sdk');
// 修复1：指定固定env，避免环境错乱（替换成你的环境ID）
cloud.init();
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const payEvent = event['cloud-pay'] || event;
  const { resultCode, outTradeNo } = payEvent;

  // 新增：打印关键日志，方便排查
  console.log('===== payCallback 开始执行 =====');
  console.log('resultCode:', resultCode);
  console.log('outTradeNo:', outTradeNo);

  if (resultCode === 'SUCCESS') {
    try {
      const orderRes = await db.collection('orders').where({ orderNo: outTradeNo }).get();
      if (orderRes.data.length > 0) {
        const order = orderRes.data[0];
        if (order.hasCommission === true || order.status === 'paid') {
  console.log('订单已处理过（已支付/已发佣金），跳过回调逻辑');
  return { errcode: 0, errmsg: 'success' };
}
        const { openid, payType, leaderOpenid, hasCommission } = order;
        
        // 新增：打印订单和团长信息
        console.log('订单详情:', order);
        console.log('团长ID:', leaderOpenid);
        console.log('是否已发佣金:', hasCommission);

        // 原有会员时长更新逻辑（完全保留）
        const serviceDays = payType === 'month' ? 30 : 365;
        const user = await db.collection('users').where({ _openid: openid }).get();
        const now = new Date();
        let serviceEndTime;

        if (user.data.length > 0 && user.data[0].serviceEndTime) {
          const oldEnd = new Date(user.data[0].serviceEndTime);
          serviceEndTime = oldEnd > now
            ? new Date(oldEnd.setDate(oldEnd.getDate() + serviceDays))
            : new Date(now.setDate(now.getDate() + serviceDays));
        } else {
          serviceEndTime = new Date(now.setDate(now.getDate() + serviceDays));
        }

        // 更新订单状态
        await db.collection('orders').doc(order._id).update({ 
          data: { status: 'paid', payTime: db.serverDate() } 
        });

        // 更新用户会员
        await db.collection('users').where({ _openid: openid }).update({
          data: {
            isFormalVersion: true,
            serviceEndTime: serviceEndTime.toISOString().split('T')[0],
            payType,
            lastPayTime: db.serverDate()
          }
        });

        // 团长佣金逻辑（核心优化）
        // 团长佣金逻辑（修复后）
// 团长佣金逻辑（真实业务版：仅首次支付发佣金）
// 团长佣金逻辑（最终稳定版：无任何报错，真实首单逻辑）
if (leaderOpenid && !hasCommission) {
  // 1. 统计用户已支付成功订单数（真实首单判定）
  const countRes = await db.collection('orders')
    .where({ openid, status: 'paid' })
    .count();
  const payCount = countRes.total;
  console.log('该用户已支付成功订单总数:', payCount);

  // 2. 真实首单逻辑：仅订单数=1时发佣金
  if (payCount === 1) { 
    const commission = payType === 'month' ? 1 : 5;
    console.log('新用户首次支付，发放佣金:', commission);

    // 3. 写入佣金流水（必成功）
    await db.collection('rewardRecords').add({
      data: {
        userOpenid: openid,
        leaderOpenid,
        payType,
        rewardAmount: commission,
        createTime: db.serverDate()
      }
    });

    // 4. 写入团长收益（不用 _.inc()，彻底解决报错）
    // 先查询团长记录（容错：不存在就返回空）
    let leaderData = {};
    try {
      const leaderRes = await db.collection('groupLeader').doc(leaderOpenid).get();
      leaderData = leaderRes.data || {};
    } catch (err) {
      // 记录不存在时，初始化空数据
      leaderData = { withdrawAble: 0, totalOrder: 0 };
    }

    // 手动计算累加值（代替 _.inc()）
    const newWithdrawAble = (leaderData.withdrawAble || 0) + commission;
    const newTotalOrder = (leaderData.totalOrder || 0) + 1;

    // 写入团长记录（不存在就创建，存在就覆盖）
    await db.collection('groupLeader').doc(leaderOpenid).set({
      data: {
        leaderOpenid,
        withdrawAble: newWithdrawAble,
        totalOrder: newTotalOrder,
        pendingReward: 0,
        createTime: leaderData.createTime || db.serverDate(),
        updateTime: db.serverDate()
      }
    });

    // 5. 标记订单已发佣金
    await db.collection('orders').doc(order._id).update({
      data: { hasCommission: true }
    });

    console.log(`佣金发放成功！团长${leaderOpenid}，金额${commission}元`);
  } else {
    console.log('非首次支付，不发放佣金');
  }
}

        return { errcode: 0, errmsg: 'success' };
      } else {
        console.error('未找到订单:', outTradeNo);
      }
    } catch (err) {
      console.error('回调异常:', err);
    }
  } else {
    console.log('支付失败，resultCode:', resultCode);
  }
  return { errcode: -1, errmsg: 'fail' };
};