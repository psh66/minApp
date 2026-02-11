// cloudfunctions/deleteRecord/index.js
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const { recordId, collectionName } = event;

    // 校验参数
    if (!recordId || !collectionName) {
      return {
        success: false,
        msg: "缺少必要参数：recordId/collectionName",
      };
    }

    // 校验是否为管理员（仅管理员可删除）
    const wxContext = cloud.getWXContext();
    const adminRes = await db
      .collection("adminUsers")
      .where({ openid: wxContext.OPENID })
      .get();

    if (adminRes.data.length === 0) {
      return {
        success: false,
        msg: "无管理员权限，禁止删除操作",
      };
    }

    // 执行删除操作（云函数拥有最高权限）
    const deleteRes = await db
      .collection(collectionName)
      .doc(recordId)
      .remove();

    if (deleteRes.stats.removed === 1) {
      return {
        success: true,
        msg: "删除成功",
      };
    } else {
      return {
        success: false,
        msg: "删除失败：记录不存在或已被删除",
      };
    }
  } catch (err) {
    console.error("删除记录失败：", err);
    return {
      success: false,
      msg: `删除失败：${err.message || "未知错误"}`,
    };
  }
};
