const cloud = require('wx-server-sdk');
cloud.init();
const db = cloud.database();

exports.main = async (event, context) => {
  const { resultCode, outTradeNo } = event['cloud-pay'];
  if (resultCode === 'SUCCESS') {
    try {
      const order = await db.collection('orders').where({ orderNo: outTradeNo }).get();
      if (order.data.length > 0) {
        const { openid, payType } = order.data[0];
        const serviceDays = payType === 'month' ? 30 : 365;
        const user = await db.collection('users').where({ _openid: openid }).get();
        const now = new Date();
        const serviceEndTime = user.data.length > 0 && user.data[0].serviceEndTime && new Date(user.data[0].serviceEndTime) > now
          ? new Date(new Date(user.data[0].serviceEndTime).setDate(new Date(user.data[0].serviceEndTime).getDate()+serviceDays))
          : new Date(now.setDate(now.getDate()+serviceDays));

        await db.collection('orders').where({ orderNo: outTradeNo }).update({ data: { status: 'paid', payTime: db.serverDate() } });
        await db.collection('users').where({ _openid: openid }).update({
          data: {
            isFormalVersion: true,
            serviceEndTime: serviceEndTime.toISOString().split('T')[0],
            payType,
            lastPayTime: db.serverDate()
          }
        });
        return { errcode: 0, errmsg: 'success' };
      }
    } catch (err) {
      console.error('回调处理失败：', err);
    }
  }
  return { errcode: -1, errmsg: 'fail' };
};