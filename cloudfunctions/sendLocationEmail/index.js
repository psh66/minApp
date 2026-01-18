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
    const { location, emailList, userName } = event;
    if (!emailList || emailList.length === 0) return { success: false, msg: '无绑定邮箱' };

    // 生成地图链接
    const mapUrl = `https://apis.map.qq.com/tools/poimarker?type=0&marker=coord:${location.lat},${location.lng};title:${userName}的位置&key=OB4BZ-D4W3U-B7VVO-4PJWW-6TKDJ-WPB77&referer=myapp`;

    await transporter.sendMail({
      from: '"咱爸咱妈平安签" <1476069379@qq.com>',
      to: emailList.map(item => item.email).join(','),
      subject: '紧急定位：' + userName + '的实时位置',
      html: `
        <div>
          <p>尊敬的用户：</p>
          <p>您好！${userName}触发了「一键发送定位」功能，当前位置如下：</p>
          <p>📍 地址：${location.address}</p>
          <p>🗺️ 地图链接：<a href="${mapUrl}" target="_blank">点击查看位置</a></p>
          <p>请您尽快确认情况，确保${userName}的安全。</p>
          <p>「咱爸咱妈平安签」团队</p>
        </div>
      `
    });

    return { success: true, msg: '定位邮件发送成功' };
  } catch (err) {
    console.error('发送定位邮件失败：', err);
    return { success: false, msg: '发送失败', error: err.message };
  }
}