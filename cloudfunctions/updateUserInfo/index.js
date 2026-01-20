// 官方模板自动安装了wx-server-sdk，无需手动装
const cloud = require('wx-server-sdk')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 必须加这行！实例化数据库对象
const db = cloud.database();

// 极简版：更新用户提醒开关状态
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { enableRemind } = event; // 接收前端传的开关状态
  const OPENID = wxContext.OPENID;
  
  // 新增日志：记录函数开始执行，方便排查
  console.log(`📌 开始更新用户${OPENID}的提醒开关，状态：${enableRemind}`);
  
  try {
    await db.collection('users').where({ _openid: OPENID }).update({
      data: {
        enableRemind // 更新users集合的开关字段
      }
    });
    console.log(`✅ 用户${OPENID}提醒开关更新成功`);
    return { 
      success: true,
      openid: OPENID
    };
  } catch (err) {
    console.error(`❌ 用户${OPENID}提醒开关更新失败：`, err);
    return { 
      success: false, 
      error: err.message,
      openid: OPENID
    };
  }
};