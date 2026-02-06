const cloud = require("wx-server-sdk");
// 初始化云环境（动态获取当前环境，无需手动改）
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ====================== 【需替换为你的配置】 ======================
const CONFIG = {
  subAppid: "你的小程序APPID", // 替换成自己的小程序APPID
  subMchId: "1684021201", // 你的子商户号（保留原有值即可）
};
// ====================================================================

exports.main = async (event, context) => {
  // 核心修改：新增 leaderOpenid（推广团长openid），保留原有所有参数
  const { openid, payType, amount, payerOpenid, leaderOpenid } = event;

  // 1. 前置校验（保留原有校验，新增leaderOpenid非必传，不影响原有支付）
  if (!openid) {
    return { success: false, msg: "支付目标openid不能为空" };
  }
  if (!payerOpenid) {
    return { success: false, msg: "付款人openid不能为空" };
  }
  if (!["month", "year"].includes(payType)) {
    return { success: false, msg: "支付类型错误，仅支持month/year" };
  }
  if (!amount || isNaN(amount) || amount <= 0) {
    return { success: false, msg: "请输入有效支付金额" };
  }

  // 2. 生成唯一订单号（原有逻辑，保证不重复）
  const orderNo =
    "ORD" +
    Date.now() +
    Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0");

  try {
    // 3. 保存订单到现有orders集合（核心：新增leaderOpenid字段，绑定推广团长）
    await db.collection("orders").add({
      data: {
        orderNo,
        openid, // 支付目标openid（父母，权益归属）
        payerOpenid, // 付款人openid（子女，实际付款人）
        leaderOpenid, // 新增：推广团长openid（无推广则为null）
        payType,
        amount,
        status: "pending",
        createTime: db.serverDate(),
      },
    });

    // 4. 调用微信支付统一下单接口（保留原有逻辑，配置项抽离到CONFIG，更易维护）
    const res = await cloud.cloudPay.unifiedOrder({
      body: payType === "month" ? "月付会员" : "年付会员",
      outTradeNo: orderNo,
      spbillCreateIp: "127.0.0.1",
      totalFee: Math.round(amount * 100), // 强转整数，避免小数分币问题
      envId: cloud.getWXContext().ENV,
      functionName: "payCallback", // 原有支付回调云函数，不变
      tradeType: "JSAPI",
      openid, // 仍用父母openid，保证权益归属
      subMchId: CONFIG.subMchId,
      subAppid: CONFIG.subAppid,
    });
    console.log("【微信支付统一下单成功】结果：", res);

    // 5. 返回小程序端拉起支付的参数（原有逻辑，完全不变）
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
    // 错误日志优化，方便排查问题
    console.error("【创建订单失败】原因：", err);
    return {
      success: false,
      msg: err.message || "微信支付统一下单接口调用失败",
      errCode: err.errCode || "UNKNOWN",
    };
  }
};
