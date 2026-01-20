// 官方模板自动安装了wx-server-sdk，无需手动装
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 极简版：更新用户提醒开关状态
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { enableRemind } = event;
  const OPENID = wxContext.OPENID;
  try {
    await db.collection('users').where({ _openid: OPENID }).update({
      data: {
        enableRemind
      }
    });
    return { 
      success: true,
      openid: OPENID
    };
  } catch (err) {
    console.error('更新提醒开关失败：', err);
    return { 
      success: false, 
      error: err.message,
      openid: OPENID
    };
  }
};