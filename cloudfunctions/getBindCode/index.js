// cloudfunctions/getBindCode/index.js 最终版
const cloud = require('wx-server-sdk')
cloud.init()
const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const bindCode = Math.floor(Math.random() * 900000 + 100000).toString()
  console.log('openid:', openid, 'bindCode:', bindCode)

  try {
    // 用 _openid 匹配现有文档，而不是用 openid 作为文档 ID
    const res = await db.collection('users').where({ _openid: openid }).get()
    if (res.data.length === 0) {
      return { success: false, errMsg: '用户不存在，请先注册' }
    }

    // 更新找到的现有文档
    await db.collection('users').doc(res.data[0]._id).update({
      data: { bindCode, createTime: db.serverDate() }
    })
    return { success: true, bindCode }
  } catch (err) {
    return { success: false, errMsg: err.message }
  }
}