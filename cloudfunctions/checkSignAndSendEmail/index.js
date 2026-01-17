// 云函数入口文件
const cloud = require('wx-server-sdk')
const nodemailer = require('nodemailer')
cloud.init()
const db = cloud.database()

// 已配置真实QQ邮箱SMTP信息
const transporter = nodemailer.createTransport({
  host: 'smtp.qq.com',
  port: 465,
  secure: true,
  auth: {
    user: '1476069379@qq.com', // 你的真实QQ邮箱账号
    pass: 'ksfntxnghwswgjgc'  // 你的真实SMTP授权码
  }
})

// 云函数入口函数
exports.main = async (event, context) => {
  try {
    // 计算时间范围：过去两天
    const twoDaysAgo = new Date()
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
    twoDaysAgo.setHours(0, 0, 0, 0)

    // 查询所有绑定邮箱的用户
    const usersRes = await db.collection('users').get()
    for (const user of usersRes.data) {
      if (!user.email) continue;

      // 查询用户过去两天的签到记录
      const signRes = await db.collection('signRecords')
        .where({
          _openid: user.openid,
          signTime: db.command.gte(twoDaysAgo)
        }).get()

      // 无签到记录则发送邮件
      if (signRes.data.length === 0) {
        const contactRes = await db.collection('contacts')
          .where({ _openid: user.openid }).limit(1).get()
        const contactName = contactRes.data.length > 0 ? contactRes.data[0].name : '家人'

        await transporter.sendMail({
          from: '"独居安全助手" <1476069379@qq.com>', // 发件人（与上方user一致）
          to: user.email, // 收件人（用户绑定的紧急联系人邮箱）
          subject: '紧急提醒：家人连续两天未签到',
          html: `
            <div>
              <p>尊敬的用户：</p>
              <p>您好！您的家人【${contactName}】已连续2天未使用「独居安全助手」小程序签到，请您尽快通过电话或微信联系确认情况。</p>
              <p>若您已确认家人安全，可忽略此提醒；若长时间无法联系，请及时采取必要措施。</p>
              <p>感谢您的使用！</p>
              <p>「独居安全助手」团队</p>
            </div>
          `
        })
      }
    }
    return { success: true, msg: '邮件发送任务执行完成' }
  } catch (err) {
    console.error('邮件发送失败：', err)
    return { success: false, msg: '执行失败', error: err.message }
  }
}