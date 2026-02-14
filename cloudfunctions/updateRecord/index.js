// cloudfunctions/updateRecord/index.js
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const { recordId, collectionName, updateData } = event;
    
    // 参数校验
    if (!recordId || !collectionName || !updateData) {
      return {
        success: false,
        msg: "参数缺失（recordId/collectionName/updateData）"
      };
    }

    // 更新数据库记录
    await db.collection(collectionName).doc(recordId).update({
      data: updateData
    });

    return {
      success: true,
      msg: "记录更新成功"
    };
  } catch (err) {
    console.error("更新记录失败：", err);
    return {
      success: false,
      msg: `更新失败：${err.message}`
    };
  }
};