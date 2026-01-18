const cloud = require('wx-server-sdk');
// 初始化云环境（替换为你的环境ID，或保留DYNAMIC_CURRENT_ENV）
cloud.init();
const db = cloud.database();

exports.main = async (event, context) => {
  const { openid, payType, amount } = event;
  
  // 1. 前置校验（必做）
  if (!openid) {
    return { success: false, msg: 'openid不能为空' };
  }
  if (!['month', 'year'].includes(payType)) {
    return { success: false, msg: '支付类型错误' };
  }
  if (!amount || isNaN(amount)) {
    return { success: false, msg: '金额错误' };
  }

  // 2. 生成订单号
  const orderNo = 'ORD' + Date.now() + Math.floor(Math.random()*1000).toString().padStart(3, '0');

  try {
    // 3. 保存订单到数据库
    await db.collection('orders').add({
      data: {
        orderNo,
        openid,
        payType,
        amount,
        status: 'pending',
        createTime: db.serverDate()
      }
    });

    // 4. 调用微信支付统一下单接口
    const res = await cloud.cloudPay.unifiedOrder({
      body: payType === 'month' ? '月付会员' : '年付会员', // 订单标题
      outTradeNo: orderNo, // 订单号
      spbillCreateIp: '127.0.0.1', // 固定值
      totalFee: amount * 100, // 金额（分），必须是整数
      envId: cloud.getWXContext().ENV, // 当前环境ID
      functionName: 'payCallback', // 支付回调云函数名
      tradeType: 'JSAPI', // 小程序支付固定值
      openid, // 用户openid
      subMchId: '1684021201', // 新增：子商户号（关键！）
      subAppid: '你的小程序APPID' // 可选：若子商户绑定了专属APPID，需填写
    });
    console.log('支付', res);
    // 5. 返回支付参数
    return {
      success: true,
      payParams: {
        timeStamp: res.payment.timeStamp.toString(),
        nonceStr: res.payment.nonceStr,
        package: res.payment.package,
        signType: 'MD5',
        paySign: res.payment.paySign
      }
    };
  } catch (err) {
    // 打印详细错误日志（方便排查）
    console.error('创建订单失败：', err);
    return { success: false, msg: err.message || '统一下单接口调用失败' };
  }
};