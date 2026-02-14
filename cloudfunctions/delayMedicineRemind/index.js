const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 配置（和主函数保持一致）
const TEMPLATE_ID = "TTh86bIvpQrQjBZ2OSOcw4onxCo0Eey4wjTAtoXNl-E";
const APPID = "wx026286eb5b348d4e";
const APPSECRET = "f59391e566a0216df152b0b4c3886b88";

// 格式化时间（兼容北京时间）
function formatTimeToHM(date) {
  if (!date || !(date instanceof Date)) {
    date = new Date(Date.now() + 8 * 60 * 60 * 1000); // 北京时间
  }
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

/**
 * 检查并扣减用户订阅次数（复用主函数逻辑，保持统一）
 */
async function checkAndDeductUserQuota(openid, tmplId) {
  try {
    const queryRes = await db
      .collection("userSubscribe")
      .where({ openid, tmplId })
      .get();
    let remainCount =
      queryRes.data.length > 0 ? queryRes.data[0].remainCount || 0 : 0;

    if (remainCount <= 0) {
      return {
        success: false,
        remainCount: 0,
        msg: `用户${openid}剩余订阅次数为0，无法推送`,
      };
    }

    const deductRes = await cloud.callFunction({
      name: "updateUserSubscribeCount",
      data: { openid, tmplId, increment: -1 },
    });

    if (!deductRes.result?.success) {
      return {
        success: false,
        remainCount,
        msg: `扣减次数失败：${deductRes.result?.msg || "未知错误"}`,
      };
    }

    return {
      success: true,
      remainCount: remainCount - 1,
      msg: `扣减成功，剩余次数：${remainCount - 1}`,
    };
  } catch (err) {
    console.error("用户次数校验/扣减失败：", err);
    return {
      success: false,
      remainCount: 0,
      msg: `次数操作异常：${err.message}`,
    };
  }
}

/**
 * 获取微信access_token（增加缓存逻辑，避免重复请求）
 */
let accessTokenCache = "";
let tokenExpireTime = 0;
async function getWxAccessToken() {
  // 缓存未过期则直接返回
  if (accessTokenCache && Date.now() < tokenExpireTime) {
    return accessTokenCache;
  }

  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      grant_type: "client_credential",
      appid: APPID,
      secret: APPSECRET,
    });

    require("https")
      .get(`https://api.weixin.qq.com/cgi-bin/token?${params}`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            if (result.errcode) {
              reject(
                new Error(
                  `token获取失败：${result.errmsg}（${result.errcode}）`,
                ),
              );
              return;
            }
            // 缓存token，有效期7200秒（提前100秒过期）
            accessTokenCache = result.access_token;
            tokenExpireTime = Date.now() + (result.expires_in - 100) * 1000;
            resolve(result.access_token);
          } catch (err) {
            reject(new Error(`解析token失败：${err.message}`));
          }
        });
      })
      .on("error", (err) => reject(new Error(`请求token失败：${err.message}`)));
  });
}

/**
 * 发送订阅消息（统一格式，适配模板要求）
 */
async function sendSubscribeMessage(openid, type, remind) {
  if (!openid || !remind) return false;

  // 第一步：校验并扣减次数
  const quotaCheck = await checkAndDeductUserQuota(openid, TEMPLATE_ID);
  if (!quotaCheck.success) {
    console.error(`推送失败：${quotaCheck.msg}`);
    return false;
  }

  // 处理提醒时间（兼容数组）
  let remindTime = remind.remindTime;
  if (Array.isArray(remindTime)) remindTime = remindTime[0];
  remindTime = String(remindTime || "").trim() || formatTimeToHM();
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]; // 北京时间

  // 第二步：构造模板数据（严格匹配模板字段）
  let templateData = {};
  switch (type) {
    case "formal":
      templateData = {
        touser: openid,
        template_id: TEMPLATE_ID,
        page: "/pages/index/index",
        data: {
          thing1: { value: "爸妈" },
          time2: { value: `${today} ${remindTime}` },
          phrase3: { value: "按时服药" },
        },
        miniprogram_state: "formal",
        lang: "zh_CN",
      };
      break;
    case "over10_parent":
      templateData = {
        touser: openid,
        template_id: TEMPLATE_ID,
        page: "/pages/index/index",
        data: {
          thing1: { value: "爸妈" },
          time2: { value: `${today} ${remindTime}` },
          phrase3: { value: "超时未服" },
        },
        miniprogram_state: "formal",
        lang: "zh_CN",
      };
      break;
    case "child":
      templateData = {
        touser: openid,
        template_id: TEMPLATE_ID,
        page: "/pages/index/index",
        data: {
          thing1: { value: "爸爸/妈妈" },
          time2: { value: `${today} ${remindTime}` },
          phrase3: { value: "未服提醒" },
        },
        miniprogram_state: "formal",
        lang: "zh_CN",
      };
      break;
    case "final":
      templateData = {
        touser: openid,
        template_id: TEMPLATE_ID,
        page: "/pages/index/index",
        data: {
          thing1: { value: "爸妈" },
          time2: { value: `${today} ${remindTime}` },
          phrase3: { value: "最后提醒" },
        },
        miniprogram_state: "formal",
        lang: "zh_CN",
      };
      break;
    default:
      return false;
  }

  // 第三步：发送消息（带重试）
  try {
    const accessToken = await getWxAccessToken();
    const result = await new Promise((resolve, reject) => {
      const postData = JSON.stringify(templateData);
      const req = require("https").request(
        {
          method: "POST",
          hostname: "api.weixin.qq.com",
          path: `/cgi-bin/message/subscribe/send?access_token=${accessToken}`,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          },
          timeout: 10000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const resData = JSON.parse(data);
              if (resData.errcode !== 0) {
                reject(new Error(`${resData.errmsg}（${resData.errcode}）`));
              } else {
                resolve(resData);
              }
            } catch (err) {
              reject(new Error(`解析返回失败：${err.message}`));
            }
          });
        },
      );
      req.on("error", (err) => reject(new Error(`请求失败：${err.message}`)));
      req.write(postData);
      req.end();
    });

    console.log(
      `推送成功（${type}），用户${openid}剩余次数：${quotaCheck.remainCount}`,
    );
    return true;
  } catch (err) {
    console.error(`推送失败（${type}，openid:${openid}）：`, err.message);
    // 若token失效，清空缓存重试一次
    if (
      err.message.includes("access_token") ||
      err.message.includes("-501001")
    ) {
      accessTokenCache = "";
      tokenExpireTime = 0;
      return await sendSubscribeMessage(openid, type, remind);
    }
    return false;
  }
}

/**
 * 检查今日是否已服药（核心校验）
 */
async function checkIfCompleted(remind) {
  if (!remind?._id || !remind?.parentOpenid) return false;
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0]; // 北京时间
  try {
    const res = await db
      .collection("medicineRecord")
      .where({
        remindId: remind._id,
        parentOpenid: remind.parentOpenid,
        createTime: db.command.gte(new Date(today)),
        takeStatus: "completed",
      })
      .get();
    return res.data.length > 0;
  } catch (err) {
    console.error("检查服药状态失败：", err);
    return false;
  }
}

/**
 * 更新服药记录状态（仅推送成功时更新）
 */
async function updateRecordStatus(remind, status) {
  if (!remind?._id || !remind?.parentOpenid) return false;
  let remindTime = remind.remindTime;
  if (Array.isArray(remindTime)) remindTime = remindTime[0];
  remindTime = String(remindTime || "").trim() || formatTimeToHM();
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  try {
    const res = await db
      .collection("medicineRecord")
      .where({
        remindId: remind._id,
        parentOpenid: remind.parentOpenid,
        createTime: db.command.gte(new Date(today)),
      })
      .get();

    const recordData = {
      remindId: remind._id,
      parentOpenid: remind.parentOpenid,
      remindTime,
      takeStatus: status,
      updateTime: db.serverDate(),
    };

    if (res.data.length === 0) {
      recordData.createTime = db.serverDate();
      await db.collection("medicineRecord").add({ data: recordData });
    } else {
      await db
        .collection("medicineRecord")
        .doc(res.data[0]._id)
        .update({ data: recordData });
    }
    console.log("更新记录状态成功：", status);
    return true;
  } catch (err) {
    console.error("更新状态失败：", err);
    return false;
  }
}

// 入口函数
exports.main = async (event, context) => {
  try {
    const { type, remind } = event;
    if (!type || !remind?.parentOpenid) {
      return { success: false, msg: "参数缺失" };
    }

    console.log(`===== 执行${type}类型用药提醒 =====`);
    console.log(
      `父母OpenID：${remind.parentOpenid}，提醒时间：${remind.remindTime}`,
    );

    // 核心校验：已服药则直接返回，不推送
    if (await checkIfCompleted(remind)) {
      return { success: true, msg: "用户已服药，无需推送" };
    }

    let success = false;
    // 执行推送逻辑
    if (type === "formal") {
      success = await sendSubscribeMessage(
        remind.parentOpenid,
        "formal",
        remind,
      );
      if (success) await updateRecordStatus(remind, "formal_reminded");
    } else if (type === "over10") {
      // 先推父母端超时提醒
      success = await sendSubscribeMessage(
        remind.parentOpenid,
        "over10_parent",
        remind,
      );
      // 再推子女端提醒（如果有childOpenid）
      if (remind.childOpenid) {
        await sendSubscribeMessage(remind.childOpenid, "child", remind);
      }
      if (success) await updateRecordStatus(remind, "over10_reminded");
    } else if (type === "final") {
      success = await sendSubscribeMessage(
        remind.parentOpenid,
        "final",
        remind,
      );
      if (success) await updateRecordStatus(remind, "final_reminded");
    } else {
      return { success: false, msg: `未知提醒类型：${type}` };
    }

    return {
      success,
      msg: `${type}类型提醒${success ? "推送成功" : "推送失败"}`,
    };
  } catch (err) {
    console.error("延时云函数执行失败：", err);
    return { success: false, msg: err.message };
  }
};
