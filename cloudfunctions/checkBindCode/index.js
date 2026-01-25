// cloudfunctions/checkBindCode/index.js 修正后
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()

exports.main = async (event, context) => {
  const { bindCode } = event
  
  // 改动1：校验入参（避免空绑定码查询）
  if (!bindCode || bindCode.length !== 6) {
    return { success: false, errMsg: '请输入6位有效绑定码' }
  }

  try {
    // 改动2：集合名从 user 改为 users（和你前端/生成绑定码的逻辑统一）
    const res = await db.collection('users').where({ bindCode }).get()
    console.log('查询结果：----', res)
    if (res.data.length === 0) {
      return { success: false, errMsg: '绑定码无效' }
    }
    
    // 优化：返回更完整的父母信息（方便前端使用）
    return { 
      success: true, 
      parentOpenid: res.data[0]._openid,
      parentInfo: res.data[0] // 可选：返回父母的昵称/头像等信息
    }
  } catch (err) {
    return { success: false, errMsg: '查询失败：' + err.message }
  }
}