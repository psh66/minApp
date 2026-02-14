const cloud = require("wx-server-sdk");

// 初始化云开发环境（动态获取当前环境）
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 配置唯一的服务通知模板ID（长者用药情况通知）
const TEMPLATE_ID = "TTh86bIvpQrQjBZ2OSOcw4onxCo0Eey4wjTAtoXNl-E";

/**
 * 工具函数：格式化时间为 HH:mm 格式
 * @param {String|Date} time - 时间字符串/Date对象
 * @returns {String} 格式化后的时间（HH:mm）
 */
function formatTimeToHM(time) {
  let date;
  if (typeof time === "string") {
    return time.trim();
  } else if (time instanceof Date) {
    date = time;
  } else {
    date = new Date();
  }
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`;
}

/**
 * 全局订阅次数管理工具函数
 * @param {String} tmplId - 模板ID
 * @param {Boolean} deduct - 是否扣减次数（true=扣减，false=仅查询）
 * @returns {Object} { success: 布尔, remainCount: 剩余次数, msg: 提示 }
 */
async function manageGlobalQuota(tmplId, deduct = false) {
  try {
    const res = await db
      .collection("globalSubscribeQuota")
      .where({ tmplId })
      .get();

    let quotaDoc = null;
    let totalCount = 0;
    let usedCount = 0;

    if (res.data.length === 0) {
      await db.collection("globalSubscribeQuota").add({
        data: {
          tmplId,
          name: "用药提醒通知",
          totalCount: 0,
          usedCount: 0,
          updateTime: db.serverDate(),
        },
      });
      return {
        success: false,
        remainCount: 0,
        msg: "全局次数未初始化，请管理员先添加次数",
      };
    }

    quotaDoc = res.data[0];
    totalCount = quotaDoc.totalCount || 0;
    usedCount = quotaDoc.usedCount || 0;
    const remainCount = totalCount - usedCount;

    if (!deduct) {
      return { success: true, remainCount, msg: `剩余次数：${remainCount}` };
    }

    if (remainCount <= 0) {
      return {
        success: false,
        remainCount: 0,
        msg: "全局订阅次数已用完，请管理员增加次数",
      };
    }

    await db
      .collection("globalSubscribeQuota")
      .doc(quotaDoc._id)
      .update({
        data: {
          usedCount: db.command.inc(1),
          updateTime: db.serverDate(),
        },
      });

    return { success: true, remainCount: remainCount - 1, msg: "次数扣减成功" };
  } catch (err) {
    console.error("全局次数管理失败：", err);
    return {
      success: false,
      remainCount: 0,
      msg: `次数管理异常：${err.message}`,
    };
  }
}

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    const {
      childOpenid,
      medicineName,
      takeTime,
      parentName = "爸妈",
      extraTips = "",
    } = event;

    // 1. 核心参数校验
    if (!childOpenid || childOpenid.trim() === "") {
      return {
        success: false,
        errMsg: "参数缺失：childOpenid（子女OpenID）不能为空",
      };
    }
    if (!medicineName || medicineName.trim() === "") {
      return {
        success: false,
        errMsg: "参数缺失：medicineName（药品名称）不能为空",
      };
    }

    // 2. 新增：推送前校验全局次数
    const quotaCheck = await manageGlobalQuota(TEMPLATE_ID, false);
    if (!quotaCheck.success) {
      return {
        success: false,
        errMsg: quotaCheck.msg,
      };
    }

    // 3. 格式化时间
    const formattedTakeTime = takeTime
      ? formatTimeToHM(takeTime)
      : formatTimeToHM(new Date());
    const today = new Date().toISOString().split("T")[0];
    const dateStr = `${today} ${formattedTakeTime}`;

    // 4. 拼接服药情况描述
    let thingContent = `${formattedTakeTime}的${medicineName}已完成服用`;
    if (extraTips) {
      thingContent += `，${extraTips}`;
    }

    // 5. 调用微信订阅消息接口推送通知
    const result = await cloud.openapi.subscribeMessage.send({
      touser: childOpenid,
      page: "/pages/index/index",
      templateId: TEMPLATE_ID,
      data: {
        name1: { value: parentName },
        date2: { value: dateStr },
        thing3: { value: thingContent },
      },
    });

    // 6. 新增：推送成功后扣减全局次数
    const quotaDeduct = await manageGlobalQuota(TEMPLATE_ID, true);
    if (!quotaDeduct.success) {
      console.warn(`推送成功但次数扣减失败：${quotaDeduct.msg}`);
    } else {
      console.log(`推送成功，剩余次数：${quotaDeduct.remainCount}`);
    }

    // 7. 返回成功结果
    return {
      success: true,
      msg: "子女端服药完成通知推送成功",
      data: result,
    };
  } catch (err) {
    console.error("[sendMedicineNoticeToChild] 推送服药通知失败：", err);

    let errMsg = err.message;
    if (errMsg.includes("openapi.subscribeMessage.send:fail")) {
      if (errMsg.includes("template id empty")) {
        errMsg = "模板ID未配置，请检查TEMPLATE_ID常量";
      } else if (errMsg.includes("touser empty")) {
        errMsg = "接收者OpenID为空，请检查childOpenid参数";
      } else if (errMsg.includes("data format error")) {
        errMsg = "模板数据格式错误，请检查关键词配置";
      } else if (errMsg.includes("user not subscribe")) {
        errMsg = "用户未授权该模板的通知权限";
      }
    }

    return {
      success: false,
      errMsg: errMsg,
      detail: err.stack,
    };
  }
};
