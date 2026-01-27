const cloud = require("wx-server-sdk");
// 初始化云环境（替换为你的环境ID，或保留DYNAMIC_CURRENT_ENV）
cloud.init();
const db = cloud.database();

exports.main = async (event, context) => {
  // 核心修改1：新增 payerOpenid（付款人openid，即子女openid），保留原有参数
  const { openid, payType, amount, payerOpenid } = event;

  // 1. 前置校验（增强：补充payerOpenid的非空校验）
  if (!openid) {
    return { success: false, msg: "支付目标openid不能为空" };
  }
  if (!payerOpenid) {
    return { success: false, msg: "付款人openid不能为空" };
  }
  if (!["month", "year"].includes(payType)) {
    return { success: false, msg: "支付类型错误" };
  }
  if (!amount || isNaN(amount)) {
    return { success: false, msg: "金额错误" };
  }

  // 2. 生成订单号（逻辑不变）
  const orderNo =
    "ORD" +
    Date.now() +
    Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");

  try {
    // 3. 保存订单到数据库（核心修改2：新增payerOpenid字段，记录谁付的款）
    await db.collection("orders").add({
      data: {
        orderNo,
        openid, // 支付目标openid（父母）
        payerOpenid, // 付款人openid（子女）
        payType,
        amount,
        status: "pending",
        createTime: db.serverDate(),
      },
    });

    // 4. 调用微信支付统一下单接口（逻辑不变，openid仍用支付目标openid）
    const res = await cloud.cloudPay.unifiedOrder({
      body: payType === "month" ? "月付会员" : "年付会员", // 订单标题
      outTradeNo: orderNo, // 订单号
      spbillCreateIp: "127.0.0.1", // 固定值
      totalFee: amount * 100, // 金额（分），必须是整数
      envId: cloud.getWXContext().ENV, // 当前环境ID
      functionName: "payCallback", // 支付回调云函数名
      tradeType: "JSAPI", // 小程序支付固定值
      openid, // 仍用支付目标openid（父母），确保支付后权益归属父母
      subMchId: "1684021201", // 你的子商户号（保留）
      subAppid: "你的小程序APPID", // 你的小程序APPID（保留）
    });
    console.log("支付统一下单结果：", res);

    // 5. 返回支付参数（逻辑不变）
    return {
      success: true,
      payParams: {
        timeStamp: res.payment.timeStamp.toString(),
        nonceStr: res.payment.nonceStr,
        package: res.payment.package,
        signType: "MD5",
        paySign: res.payment.paySign,
      },
    };
  } catch (err) {
    // 打印详细错误日志（方便排查）
    console.error("创建订单失败：", err);
    return { success: false, msg: err.message || "统一下单接口调用失败" };
  }
};
