const db = wx.cloud.database();
const usersCol = db.collection('users');

Page({
  data: {
    userName: '',
    isFormalVersion: false,
    serviceStartTime: '',
    serviceEndTime: '',
    isTrialExpired: false,
    userTypeText: '',
    showPrivacyDialog: false,
    showAboutDialog: false,
    validTimeText: '' // 新增：存储格式化后的有效期文本
  },

  onLoad() {
    this.getUserInfo();
  },

  // 移到JS里执行，可正常打印日志
  formatValidTime(startTime, endTime) {
    // 现在这里的console.log能正常输出了
    console.log('时间校验参数：', startTime, endTime);
    // 校验时间是否为有效字符串
    const isStartValid = startTime && !isNaN(new Date(startTime).getTime());
    const isEndValid = endTime && !isNaN(new Date(endTime).getTime());
    console.log('isStartValid', isStartValid, isEndValid); // 现在能打印

    // 情况1：起止时间都有效
    if (isStartValid && isEndValid) {
      const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
      };
      return `${formatDate(startTime)} - ${formatDate(endTime)}`;
    }

    // 情况2：时间无效/为空
    return '未开通会员';
  },

  async getUserInfo() {
    try {
      const app = getApp();
      const res = await usersCol.where({ _openid: app.globalData.openid }).get();
      if (res.data.length > 0) {
        const user = res.data[0];
        const isFormal = user.isFormalVersion || false;
        
        // 1. 处理创建时间（避免空值/非法时间）
        let createTime = user.createTime ? new Date(user.createTime) : new Date();
        if (isNaN(createTime.getTime())) createTime = new Date(); // 兜底为当前时间

        // 2. 计算服务起止时间
        const serviceStartTime = user.serviceStartTime || this.formatDate(createTime);
        const serviceEndTime = user.serviceEndTime || this.formatDate(new Date(createTime.setDate(createTime.getDate() + 3)));
        
        // 3. 计算是否过期
        const isTrialExpired = new Date(serviceEndTime) < new Date();
        
        // 4. 计算剩余天数（避免NaN）
        let remainDays = 0;
        if (!isTrialExpired) {
          const diff = new Date(serviceEndTime) - new Date();
          remainDays = Math.ceil(diff / (1000 * 60 * 60 * 24));
          remainDays = isNaN(remainDays) ? 0 : remainDays; // 兜底
        }

        // 5. 生成用户类型文本
        const userTypeText = isFormal 
          ? '正式会员' 
          : (isTrialExpired ? '试用已到期' : `试用会员（剩余${remainDays}天）`);
        
        // 6. 格式化有效期文本（这里调用，日志能打印）
        const validTimeText = this.formatValidTime(serviceStartTime, serviceEndTime);

        // 7. 更新数据（WXML直接用validTimeText，不再调用方法）
        this.setData({
          userName: user.name || '未设置昵称',
          isFormalVersion: isFormal,
          serviceStartTime,
          serviceEndTime,
          isTrialExpired,
          userTypeText,
          validTimeText // 新增：把格式化结果存到data里
        });
      } else {
        // 无用户数据时兜底
        this.setData({ validTimeText: '未开通会员' });
      }
    } catch (err) {
      console.error('获取用户信息失败：', err);
      this.setData({ validTimeText: '未开通会员' }); // 异常兜底
    }
  },

  formatDate(date) {
    date = new Date(date);
    if (isNaN(date.getTime())) date = new Date(); // 兜底
    return `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
  },

  // 其他方法不变...
  goToVersion() { wx.navigateTo({ url: '/pages/version/version' }); },
  showPrivacyDialog() { this.setData({ showPrivacyDialog: true }); },
  closePrivacyDialog() { this.setData({ showPrivacyDialog: false }); },
  showAboutDialog() { this.setData({ showAboutDialog: true }); },
  closeAboutDialog() { this.setData({ showAboutDialog: false }); },
  contactCustomer() {
    wx.showToast({ title: '正在打开客服会话', icon: 'none' });
    wx.openCustomerServiceChat({
      extInfo: { url: 'https://work.weixin.qq.com/kfid/kfc6f18280127625514' },
      fail: () => wx.showToast({ title: '打开客服失败', icon: 'none' })
    });
  },
  clearCache() {
    wx.clearStorageSync();
    wx.showToast({ title: '缓存已清除' });
  },
  logout() {
    wx.showModal({
      title: '确认退出',
      content: '退出后将清除本地登录状态，下次登录需重新授权',
      success: async (res) => {
        if (res.confirm) {
          wx.clearStorageSync();
          getApp().globalData.openid = null;
          wx.reLaunch({ url: '/pages/login/login' });
        }
      }
    });
  }
});