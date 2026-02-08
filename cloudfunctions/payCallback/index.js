const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  // 全链路日志：定位执行流程
  console.log("===== payCallback 开始执行 =====");
  console.log("原始回调参数：", JSON.stringify(event));

  // 解析支付回调参数
  const payEvent = event['cloud-pay'] || event;
  console.log("解析后的支付事件：", JSON.stringify(payEvent));

  const { resultCode, outTradeNo } = payEvent;
  console.log("支付结果码(resultCode)：", resultCode, "订单号(outTradeNo)：", outTradeNo);

  // 非成功支付直接返回
  if (resultCode !== 'SUCCESS') {
    console.log("支付未成功，返回失败");
    return { errcode: -1, errmsg: 'payment not success' };
  }

  try {
    // 1. 查询订单（核心：根据outTradeNo找订单）
    console.log("开始查询订单：", outTradeNo);
    const orderRes = await db.collection('orders').where({ orderNo: outTradeNo }).get();
    console.log("订单查询结果：", JSON.stringify(orderRes));

    if (orderRes.data.length === 0) {
      console.error("订单未找到：", outTradeNo);
      return { errcode: -1, errmsg: 'order not found' };
    }

    const order = orderRes.data[0];
    console.log("找到订单详情：", JSON.stringify(order));

    // 2. 检查是否已处理（防重复发佣）
    if (order.status === 'paid' || order.hasCommission) {
      console.log("订单已处理/已发佣，跳过：", outTradeNo);
      return { errcode: 0, errmsg: 'already handled' };
    }

    const { openid, payType, leaderOpenid } = order;
    console.log("订单核心信息：openid=", openid, "团长ID=", leaderOpenid, "支付类型=", payType);

    // 3. 会员时长逻辑（不影响佣金，保留）
    const serviceDays = payType === 'month' ? 30 : 365;
    const userRes = await db.collection('users').where({ _openid: openid }).get();
    const now = new Date();
    let serviceEndTime;

    if (userRes.data.length > 0 && userRes.data[0].serviceEndTime) {
      const oldEnd = new Date(userRes.data[0].serviceEndTime);
      serviceEndTime = oldEnd > now
        ? new Date(oldEnd.setDate(oldEnd.getDate() + serviceDays))
        : new Date(now.setDate(now.getDate() + serviceDays));
    } else {
      serviceEndTime = new Date(now.setDate(now.getDate() + serviceDays));
    }

    // 4. 更新订单为已支付
    await db.collection('orders').doc(order._id).update({
      data: { status: 'paid', payTime: db.serverDate() }
    });

    // 5. 更新用户会员信息
    await db.collection('users').where({ _openid: openid }).update({
      data: {
        isFormalVersion: true,
        serviceEndTime: serviceEndTime.toISOString().split('T')[0],
        payType,
        lastPayTime: db.serverDate()
      }
    });

    // 6. 团长佣金逻辑：仅新用户首单 + 非自购
    if (!leaderOpenid || leaderOpenid === openid) {
      console.log("无团长ID 或 团长自购，不发佣");
      await db.collection('orders').doc(order._id).update({ data: { hasCommission: true } });
      return { errcode: 0, errmsg: 'no leader or self buy' };
    }

    // 7. 检查是否是新用户首单（临时放宽：前2单都发佣，测试用）
    const paidCount = await db.collection('orders')
      .where({ openid, status: 'paid' }).count();
    console.log("用户历史付费订单数：", paidCount.total);

    // 临时修改：从 !==1 改为 <=2，测试阶段允许前2单发佣（正式上线改回 !==1）
    if (paidCount.total > 2) {
      console.log("非首单/次单，不发佣（订单数：", paidCount.total, "）");
      await db.collection('orders').doc(order._id).update({ data: { hasCommission: true } });
      return { errcode: 0, errmsg: 'not first/second paid' };
    }

    // 8. 计算佣金
    const commission = payType === 'month' ? 1 : 5;
    console.log("计算佣金：", commission, "元（支付类型：", payType, "）");

    // 9. 写入佣金记录
    await db.collection('rewardRecords').add({
      data: {
        userOpenid: openid,
        leaderOpenid,
        payType,
        rewardAmount: commission,
        createTime: db.serverDate()
      }
    });
    console.log("佣金记录写入成功：leaderOpenid=", leaderOpenid);

    // 10. 更新团长收益（核心：保证金额累加）
    let leader = { withdrawAble: 0, totalOrder: 0 };
    try {
      const ld = await db.collection('groupLeader').doc(leaderOpenid).get();
      if (ld.data) leader = ld.data;
      console.log("团长原有收益：", JSON.stringify(leader));
    } catch (e) {
      console.log("团长记录不存在，初始化新记录");
    }

    const newWithdraw = (leader.withdrawAble || 0) + commission;
    const newTotal = (leader.totalOrder || 0) + 1;
    console.log("团长新收益：可提现=", newWithdraw, "总订单=", newTotal);

    await db.collection('groupLeader').doc(leaderOpenid).set({
      data: {
        leaderOpenid,
        withdrawAble: newWithdraw,
        totalOrder: newTotal,
        pendingReward: 0,
        createTime: leader.createTime || db.serverDate(),
        updateTime: db.serverDate()
      }
    });

    // 11. 标记订单已发佣
    await db.collection('orders').doc(order._id).update({ data: { hasCommission: true } });
    console.log("订单标记为已发佣：", order._id);

    console.log("===== payCallback 执行完成 =====");
    return { errcode: 0, errmsg: 'success' };

  } catch (err) {
    console.error("===== payCallback 执行出错 ====", err);
    return { 
      errcode: -1, 
      errmsg: 'error', 
      detail: err.message || err.toString() 
    };
  }
};