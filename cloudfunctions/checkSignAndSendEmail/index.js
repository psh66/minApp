const cloud = require('wx-server-sdk')
const nodemailer = require('nodemailer')
cloud.init()
const db = cloud.database()

const transporter = nodemailer.createTransport({
  host: 'smtp.qq.com',
  port: 465,
  secure: true,
  auth: {
    user: '1476069379@qq.com',
    pass: 'ksfntxnghwswgjgc'
  }
})

exports.main = async (event, context) => {
  try {
    // 计算时间范围：过去两天
    const twoDaysAgo = new Date()
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)
    twoDaysAgo.setHours(0, 0, 0, 0)

    // 查询所有绑定邮箱的用户
    const emailsRes = await db.collection('emails').get();
    const userEmailMap = {};
    emailsRes.data.forEach(item => {
      if (!userEmailMap[item._openid]) {
        userEmailMap[item._openid] = [];
      }
      userEmailMap[item._openid].push(item.email);
    });

    // 遍历每个用户的邮箱列表
    for (const openid in userEmailMap) {
      const emailList = userEmailMap[openid];
      // 查询该用户近2天的签到记录
      const signRes = await db.collection('signRecords')
        .where({
          _openid: openid,
          signTime: db.command.gte(twoDaysAgo)
        }).get();

      // 无签到记录则发送邮件
      if (signRes.data.length === 0) {
        // 查询未签到用户的备注名字
        const userRes = await db.collection('users').where({ _openid: openid }).limit(1).get();
        const userName = userRes.data.length > 0 ? userRes.data[0].name : '用户';

        // 查询该用户的紧急联系人
        const contactRes = await db.collection('contacts').where({ _openid: openid }).get();
        const contactName = contactRes.data.length > 0 ? contactRes.data[0].name : '家人';

        // 给该用户的所有邮箱发邮件
        await transporter.sendMail({
          from: '"咱爸咱妈平安签" <1476069379@qq.com>',
          to: emailList.join(','),
          subject: '紧急提醒：家人连续两天未签到',
          html: `
            <div>
              <p>尊敬的用户：</p>
              <p>您好！您的家人【${userName}】已连续2天未使用「咱爸咱妈平安签」小程序签到，请您尽快通过电话或微信联系确认情况。</p>
              <p>若您已确认家人安全，可忽略此提醒；若长时间无法联系，请及时采取必要措施。</p>
              <p>感谢您的使用！</p>
              <p>「咱爸咱妈平安签」团队</p>
            </div>
          `
        });
      }
    }
    return { success: true, msg: '邮件发送任务执行完成' }
  } catch (err) {
    console.error('邮件发送失败：', err)
    return { success: false, msg: '执行失败', error: err.message }
  }
}