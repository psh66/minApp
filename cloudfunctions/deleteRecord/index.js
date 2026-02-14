// cloudfunctions/deleteRecord/index.js
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const { recordId, collectionName } = event;

    // 参数校验
    if (!recordId || !collectionName) {
      return {
        success: false,
        msg: "参数缺失（recordId/collectionName）",
      };
    }

    // 删除数据库记录
    await db.collection(collectionName).doc(recordId).remove();

    return {
      success: true,
      msg: "记录删除成功",
    };
  } catch (err) {
    console.error("删除记录失败：", err);
    return {
      success: false,
      msg: `删除失败：${err.message}`,
    };
  }
};
