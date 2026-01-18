// cloudfunctions/sendLocationEmail/index.js
const cloud = require('wx-server-sdk')
const nodemailer = require('nodemailer')
cloud.init()
const db = cloud.database()

// 邮箱配置（请替换为你的实际信息）
const transporter = nodemailer.createTransport({
  host: 'smtp.qq.com',
  port: 465,
  secure: true,
  auth: {
    user: '1476069379@qq.com', // 替换为你的QQ邮箱
    pass: 'ksfntxnghwswgjgc' // 替换为QQ邮箱授权码（不是密码）
  }
})

exports.main = async (event, context) => {
  try {
    const { location, emailList, userName } = event;
    if (!emailList || emailList.length === 0) return { success: false, msg: '无绑定邮箱' };

    // ========== 修正：使用各地图官方正确唤起链接 ==========
    const lat = location.lat;
    const lng = location.lng;
    const locationName = `${userName}的位置`;
    const encodedName = encodeURIComponent(locationName); // 编码特殊字符
    
    // 1. 腾讯地图（通用唤起链接，支持App/网页）
    const tencentMapUrl = `https://apis.map.qq.com/uri/v1/marker?marker=coord:${lat},${lng};title:${encodedName}&referer=myapp`;
    
    // 2. 高德地图（官方唤起链接）
    const amapUrl = `https://uri.amap.com/marker?position=${lng},${lat}&name=${encodedName}&src=myapp&coordinate=gaode&callnative=1`;
    
    // 3. 百度地图（官方唤起链接，修复404问题）
    const baiduMapUrl = `https://api.map.baidu.com/marker?location=${lat},${lng}&title=${encodedName}&content=${encodedName}&output=html&src=myapp`;

    // 发送邮件
    await transporter.sendMail({
      from: '"咱爸咱妈平安签" <1476069379@qq.com>', // 替换为你的QQ邮箱
      to: emailList.map(item => item.email).join(','),
      subject: '紧急定位：' + userName + '的实时位置',
      html: `
        <div style="font-size: 14px; line-height: 1.8;">
          <p>尊敬的用户：</p>
          <p>您好！${userName}触发了「一键发送定位」功能，当前位置如下：</p>
          <p>📍 地址：${location.address || '位置信息获取中'}</p>
          <p>🗺️ 地图链接：
            <a href="${tencentMapUrl}" target="_blank" style="color: #1890ff; text-decoration: none;">腾讯地图</a> |
            <a href="${amapUrl}" target="_blank" style="color: #1890ff; text-decoration: none;">高德地图</a> |
            <a href="${baiduMapUrl}" target="_blank" style="color: #1890ff; text-decoration: none;">百度地图</a>
          </p>
          <p>提示：点击链接可直接唤起手机地图App（需已安装对应地图）</p>
          <p>请您尽快确认情况，确保${userName}的安全。</p>
          <p style="margin-top: 20px;">「咱爸咱妈平安签」团队</p>
        </div>
      `
    });

    return { success: true, msg: '定位邮件发送成功' };
  } catch (err) {
    console.error('发送定位邮件失败：', err);
    return { success: false, msg: '发送失败', error: err.message };
  }
}