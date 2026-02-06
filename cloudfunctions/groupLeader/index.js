const cloud = require("wx-server-sdk");
const { v4: uuidv4 } = require("uuid");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 团长配置
const CONFIG = {
  rewardRate: 0.3,
  withdrawMin: 1,
  // 新增：小程序基础配置（替换成你的实际信息）
  appShortLink: "#小程序://咱爸咱妈平安签/sCXdY0FvLESnAsv", // 你复制的小程序短链
  posterPage: "pages/index/index", // 二维码跳转的小程序页面（首页）
};

exports.main = async (event, context) => {
  const { action, openid, amount, payeeInfo } = event;
  const { OPENID } = cloud.getWXContext();

  try {
    switch (action) {
      case "getData":
        return await getData(openid);
      case "generatePoster":
        return await generatePoster(openid);
      case "applyWithdraw":
        return await applyWithdrawManual(openid, amount, payeeInfo); // 切换为人工审核版
      default:
        return { success: false, msg: "非法action" };
    }
  } catch (e) {
    console.error("groupLeader error:", e);
    return { success: false, msg: e.message };
  }
};

// 获取团长数据
async function getData(leaderOpenid) {
  let leader = await db.collection("groupLeader").where({ leaderOpenid }).get();
  if (leader.data.length === 0) {
    await db.collection("groupLeader").add({
      data: {
        leaderOpenid,
        pendingReward: 0,
        withdrawAble: 0,
        totalOrder: 0,
        createTime: db.serverDate(),
        updateTime: db.serverDate(),
      },
    });
    leader = await db.collection("groupLeader").where({ leaderOpenid }).get();
  }

  const orderRes = await db
    .collection("orders")
    .where({ leaderOpenid })
    .orderBy("createTime", "desc")
    .limit(50)
    .get();

  // 获取提现记录
  const withdrawRes = await db
    .collection("withdrawRecord")
    .where({ leaderOpenid })
    .orderBy("createTime", "desc")
    .get();

  return {
    success: true,
    data: leader.data[0],
    orderList: orderRes.data || [],
    withdrawRecords: withdrawRes.data || [],
  };
}

// 生成带参推广海报（核心修改方法）
async function generatePoster(leaderOpenid) {
  try {
    // 1. 生成带推广人参数的二维码（scene传递leaderOpenid）
    const qrCodeResult = await cloud.openapi.wxacode.getUnlimited({
      scene: `leaderOpenid=${leaderOpenid}`, // 传递推广人openid
      page: CONFIG.posterPage, // 跳转首页
      width: 300, // 二维码宽度，建议300px
      auto_color: false, // 关闭自动配色
      line_color: { r: 255, g: 125, b: 0 }, // 二维码颜色（橙色，和你的UI匹配）
      is_hyaline: true, // 透明背景
    });

    // 2. 将二维码上传到云存储（生成唯一文件名）
    const qrCloudPath = `groupLeader/qrcode/${leaderOpenid}_${Date.now()}.png`;
    const uploadResult = await cloud.uploadFile({
      cloudPath: qrCloudPath,
      fileContent: qrCodeResult.buffer, // 二维码二进制数据
    });

    // 3. 获取二维码的临时访问链接（前端可直接显示）
    const qrDownloadUrl = await cloud.getTempFileURL({
      fileList: [uploadResult.fileID],
    });

    // 4. 返回海报相关信息（这里先返回二维码链接，后续可合成完整海报）
    return {
      success: true,
      posterPath: qrDownloadUrl.fileList[0].tempFileURL, // 二维码临时链接
      qrFileID: uploadResult.fileID, // 云存储文件ID（备用）
      shareLink: `${CONFIG.appShortLink}?leaderOpenid=${leaderOpenid}`, // 对应的推广短链
    };
  } catch (err) {
    console.error("生成海报失败:", err);
    // 失败时返回默认海报（兜底）
    return {
      success: true,
      posterPath: "/images/poster_default.png",
      msg: "二维码生成失败，使用默认海报",
    };
  }
}

// 人工审核版提现申请
async function applyWithdrawManual(leaderOpenid, amount, payeeInfo) {
  if (!amount || amount < CONFIG.withdrawMin) {
    return { success: false, msg: `最低提现${CONFIG.withdrawMin}元` };
  }

  const leaderRes = await db
    .collection("groupLeader")
    .where({ leaderOpenid })
    .get();
  if (leaderRes.data.length === 0) {
    return { success: false, msg: "团长信息不存在" };
  }

  const leaderDoc = leaderRes.data[0];
  if (leaderDoc.withdrawAble < amount) {
    return { success: false, msg: "可提现金额不足" };
  }

  // 生成提现订单号
  const outBillNo = `TX_${Date.now()}_${uuidv4().replace(/-/g, "").slice(0, 8)}`;

  // 写入提现记录（状态为审核中）
  await db.collection("withdrawRecord").add({
    data: {
      leaderOpenid,
      amount,
      payeeInfo, // 新增：收款信息
      outBillNo,
      status: "pending",
      createTime: db.serverDate(),
    },
  });

  return { success: true, msg: "提现申请已提交，等待审核" };
}
