const cloud = require('wx-server-sdk');
// 初始化云环境（自动适配当前环境，无需手动改）
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { openid, payType, amount, payerOpenid, leaderOpenid } = event;

  // ===================== 云函数日志 =====================
  console.log("===== createPayOrder 接收参数 =====");
  console.log("event =", JSON.stringify(event));
  console.log("leaderOpenid =", leaderOpenid);
  // ======================================================
  
  // 1. 前置校验（必做）
  if (!openid) {
    return { success: false, msg: 'openid不能为空' };
  }
  if (!['month', 'year'].includes(payType)) {
    return { success: false, msg: '支付类型错误' };
  }
  if (!amount || isNaN(amount) || amount <= 0) {
    return { success: false, msg: '金额错误（需大于0）' };
  }

  // 2. 生成唯一订单号
  const orderNo = 'ORD' + Date.now() + Math.floor(Math.random()*1000).toString().padStart(3, '0');

  try {
    // 3. 保存订单到数据库（修正状态为unpaid，和回调逻辑匹配）
    await db.collection('orders').add({
      data: {
        orderNo,
        openid,
        payType,
        amount,
        status: 'unpaid', // 修正：和payCallback里的判断一致
        createTime: db.serverDate(),
        payerOpenid, // 支付人openid
        leaderOpenid: leaderOpenid || "", // 兼容空值
        hasCommission: false // 标记是否已发佣
      }
    });

    // 4. 调用微信支付统一下单接口
    const res = await cloud.cloudPay.unifiedOrder({
      body: payType === 'month' ? '月付会员' : '年付会员', // 订单标题
      outTradeNo: orderNo, // 订单号
      spbillCreateIp: '127.0.0.1', // 固定值
      totalFee: Math.round(amount * 100), // 金额（分），强制取整避免小数
      envId: cloud.getWXContext().ENV, // 当前环境ID
      functionName: 'payCallback', // 支付回调云函数名
      tradeType: 'JSAPI', // 小程序支付固定值
      openid, // 用户openid
      subMchId: '1684021201', // 你的子商户号（已填）
      subAppid: 'wx026286eb5b348d4e' // 替换为你的小程序APPID（从日志里提取的）
    });
    
    console.log('微信支付统一下单结果：', JSON.stringify(res));

    // 5. 返回支付参数（兼容格式）
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
    console.error('创建支付订单失败：', err);
    return { 
      success: false, 
      msg: err.message || '统一下单接口调用失败',
      detail: err.toString()
    };
  }
};