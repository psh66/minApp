const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// ========== 你的配置（确认和实际一致即可） ==========
const APPID = "wx026286eb5b348d4e";
const APPSECRET = "f59391e566a0216df152b0b4c3886b88";
const TEMPLATE_ID = "TTh86bIvpQrQjBZ2OSOcw4onxCo0Eey4wjTAtoXNl-E";
// ===================================================

// ===================== 工具函数 =====================
function getBeijingTime() {
  const now = new Date();
  now.setTime(now.getTime() + 8 * 60 * 60 * 1000);
  return now;
}

function getTodayWeek() {
  const weekMap = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return weekMap[getBeijingTime().getDay()];
}

// 计算当前时间与提醒时间的差值（分钟）- 修正：当前时间 - 提醒时间（正数=超时）
function getTimeDiffMinutes(remindTimeStr) {
  let cleanTime = Array.isArray(remindTimeStr)
    ? remindTimeStr[0]
    : remindTimeStr;
  cleanTime = String(cleanTime || "").trim();
  if (!cleanTime || !cleanTime.includes(":")) return 999;

  const [targetHour, targetMinute] = cleanTime.split(":").map(Number);
  const nowBJ = getBeijingTime();
  const nowHour = nowBJ.getHours();
  const nowMinute = nowBJ.getMinutes();

  // 核心修正：当前时间 - 提醒时间（正数表示超时，负数表示未到）
  return nowHour * 60 + nowMinute - (targetHour * 60 + targetMinute);
}

// ===================== AccessToken 相关 =====================
let accessTokenCache = "";
let tokenExpireTime = 0;
async function getWxAccessToken() {
  if (accessTokenCache && Date.now() < tokenExpireTime) return accessTokenCache;

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

// ===================== 订阅次数校验 =====================
async function checkAndDeductUserQuota(openid, tmplId) {
  try {
    const queryRes = await db
      .collection("userSubscribe")
      .where({ openid, tmplId })
      .get();
    let remainCount =
      queryRes.data.length > 0 ? queryRes.data[0].remainCount || 0 : 0;

    console.log(`用户${openid}剩余订阅次数：${remainCount}`);

    if (remainCount <= 0) {
      console.error(`❌ 用户${openid}订阅次数为0，无法推送消息`);
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
      console.error(`❌ 用户${openid}扣减次数失败：`, deductRes.result?.msg);
      return {
        success: false,
        remainCount,
        msg: `扣减次数失败：${deductRes.result?.msg || "未知错误"}`,
      };
    }

    console.log(`✅ 用户${openid}扣减次数成功，剩余次数：${remainCount - 1}`);
    return {
      success: true,
      remainCount: remainCount - 1,
      msg: `扣减成功，剩余次数：${remainCount - 1}`,
    };
  } catch (err) {
    console.error("❌ 用户次数校验/扣减异常：", err);
    return {
      success: false,
      remainCount: 0,
      msg: `次数操作异常：${err.message}`,
    };
  }
}

// ===================== 发送订阅消息 =====================
async function sendSubscribeMessage(openid, type, remind) {
  if (!openid || !remind) return false;

  // 校验并扣减次数
  const quotaCheck = await checkAndDeductUserQuota(openid, TEMPLATE_ID);
  if (!quotaCheck.success) {
    console.error(`推送失败：${quotaCheck.msg}`);
    return false;
  }

  // 处理提醒时间
  let remindTime = remind.remindTime;
  if (Array.isArray(remindTime)) remindTime = remindTime[0];
  remindTime = String(remindTime || "").trim() || "00:00";
  const today = getBeijingTime().toISOString().split("T")[0];

  // 构造模板数据
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

  // 发送消息
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
      `✅ 推送成功（${type}），用户${openid}剩余次数：${quotaCheck.remainCount}`,
    );
    return true;
  } catch (err) {
    console.error(`❌ 推送失败（${type}，openid:${openid}）：`, err.message);
    // 增加重试逻辑
    if (
      err.message.includes("access_token") ||
      err.message.includes("request fail")
    ) {
      accessTokenCache = "";
      tokenExpireTime = 0;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return await sendSubscribeMessage(openid, type, remind);
    }
    return false;
  }
}

// ===================== 检查服药状态 =====================
async function checkIfCompleted(remind) {
  if (!remind?._id || !remind?.parentOpenid) return false;
  const today = getBeijingTime().toISOString().split("T")[0];
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
    console.log("🔍 检查服药状态：", res.data);
    return res.data.length > 0;
  } catch (err) {
    console.error("检查服药状态失败：", err);
    return false;
  }
}

// ===================== 更新记录状态 =====================
async function updateRecordStatus(remind, status) {
  if (!remind?._id || !remind?.parentOpenid) return false;
  let remindTime = remind.remindTime;
  if (Array.isArray(remindTime)) remindTime = remindTime[0];
  remindTime = String(remindTime || "").trim() || "00:00";
  const today = getBeijingTime().toISOString().split("T")[0];

  try {
    // 恢复最基础的 查→增/改 逻辑，无任何语法错误
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
    return true;
  } catch (err) {
    console.error("更新状态失败：", err);
    return false;
  }
}

// ===================== 核心：按时间差推送提醒 =====================
async function pushRemindByTimeDiff(remind) {
  try {
    const timeDiff = getTimeDiffMinutes(remind.remindTime);
    const isCompleted = await checkIfCompleted(remind);

    // 如果已经服药，直接跳过所有提醒
    if (isCompleted) {
      console.log(`⚠️ 用户已服药，跳过所有推送（remindId：${remind._id}）`);
      return;
    }

    // 查询今日的服药记录状态，防止重复推送
    const today = getBeijingTime().toISOString().split("T")[0];
    const recordRes = await db
      .collection("medicineRecord")
      .where({
        remindId: remind._id,
        parentOpenid: remind.parentOpenid,
        createTime: db.command.gte(new Date(today)),
      })
      .get();
    const record = recordRes.data[0] || {};

    console.log(
      `📌 提醒ID${remind._id}，时间差：${timeDiff}分钟，当前状态：${record.takeStatus || "未推送"}`,
    );

    // 1. 提醒时间到（0~10分钟）：正式提醒
    if (
      timeDiff >= 0 &&
      timeDiff < 10 &&
      record.takeStatus !== "formal_reminded"
    ) {
      const success = await sendSubscribeMessage(
        remind.parentOpenid,
        "formal",
        remind,
      );
      if (success) await updateRecordStatus(remind, "formal_reminded");
    }
    // 2. 超时10分钟（9~20分钟）：父母+子女提醒（放宽临界值）
    else if (
      timeDiff >= 9 &&
      timeDiff < 20 &&
      record.takeStatus !== "over10_reminded"
    ) {
      await sendSubscribeMessage(remind.parentOpenid, "over10_parent", remind);
      if (remind.childOpenid)
        await sendSubscribeMessage(remind.childOpenid, "child", remind);
      await updateRecordStatus(remind, "over10_reminded");
    }
    // 3. 超时20分钟（20~30分钟）：最后提醒
    else if (
      timeDiff >= 20 &&
      timeDiff < 30 &&
      record.takeStatus !== "final_reminded"
    ) {
      const success = await sendSubscribeMessage(
        remind.parentOpenid,
        "final",
        remind,
      );
      if (success) await updateRecordStatus(remind, "final_reminded");
    }
    // 其他时间：不推送
    else {
      console.log(
        `⏳ 时间差${timeDiff}分钟，或已推送过，暂不推送（remindId：${remind._id}）`,
      );
    }
  } catch (err) {
    console.error(`处理提醒失败（remindId：${remind._id}）：`, err.message);
  }
}

// ===================== 入口函数 =====================
exports.main = async (event, context) => {
  try {
    const nowBJ = getBeijingTime();
    const currentTime = `${nowBJ.getHours()}:${nowBJ.getMinutes()}`;
    const todayWeek = getTodayWeek();

    console.log(
      `===== 触发用药提醒检查（10分钟触发器，北京时间${currentTime}）=====`,
    );

    // 查询今日所有有效提醒（不限制小时）
    const remindList = await db
      .collection("medicineRemind")
      .field({
        remindTime: true,
        parentOpenid: true,
        childOpenid: true,
        isEnable: true,
        repeatDays: true,
      })
      .where({
        isEnable: true,
        repeatDays: db.command.in([todayWeek]),
      })
      .get();

    const remindCount = remindList.data.length;
    if (remindCount === 0) {
      return { success: true, msg: "暂无有效用药提醒" };
    }
    console.log(`📌 找到有效用药提醒：${remindCount}条`);

    // 遍历所有提醒，按时间差推送
    for (const remind of remindList.data) {
      await pushRemindByTimeDiff(remind);
    }

    return { success: true, msg: `成功处理${remindCount}条提醒任务` };
  } catch (err) {
    console.error("主函数执行失败：", err.message);
    return { success: false, msg: err.message };
  }
};
