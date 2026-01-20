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
    userInfo: {} // 用于存储提醒开关状态
  },

  onLoad() {
    this.getUserInfo();
  },

  async getUserInfo() {
    try {
      const app = getApp();
      const res = await usersCol.where({ _openid: app.globalData.openid }).get();
      if (res.data.length > 0) {
        const user = res.data[0];
        const isFormal = user.isFormalVersion || false;
        const serviceStartTime = user.serviceStartTime || this.formatDate(new Date(user.createTime));
        const serviceEndTime = user.serviceEndTime || this.formatDate(new Date(new Date(user.createTime).setDate(new Date(user.createTime).getDate()+3)));
        const isTrialExpired = new Date(serviceEndTime) < new Date();
        const userTypeText = isFormal ? '正式会员' : (isTrialExpired ? '试用已到期' : '试用会员（剩余' + Math.ceil((new Date(serviceEndTime) - new Date())/(1000*60*60*24)) + '天）');
        
        // 新增：获取提醒开关状态，默认开启
        const enableRemind = user.enableRemind ?? true;
        
        this.setData({
          userName: user.name || '未设置昵称',
          isFormalVersion: isFormal,
          serviceStartTime,
          serviceEndTime,
          isTrialExpired,
          userTypeText,
          // 新增：把开关状态存入data
          userInfo: { enableRemind }
        });
      }
    } catch (err) {
      console.error('获取用户信息失败：', err);
    }
  },

  formatDate(date) {
    date = new Date(date);
    return `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
  },

  goToVersion() {
    wx.navigateTo({ url: '/pages/version/version' });
  },

  goToSignHistory() {
    wx.navigateTo({ url: '/pages/signHistory/signHistory' });
  },

  showPrivacyDialog() {
    this.setData({ showPrivacyDialog: true });
  },

  closePrivacyDialog() {
    this.setData({ showPrivacyDialog: false });
  },

  showAboutDialog() {
    this.setData({ showAboutDialog: true });
  },

  closeAboutDialog() {
    this.setData({ showAboutDialog: false });
  },

  contactCustomer() {
    wx.showToast({ title: '正在打开客服会话', icon: 'none' });
    // wx.openCustomerServiceChat({
    //   extInfo: { url: 'https://work.weixin.qq.com/kfid/kfc6f18280127625514' },
    //   fail: () => wx.showToast({ title: '打开客服失败', icon: 'none' })
    // });
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
  },

  // 新增：切换提醒开关的事件处理函数
  async onRemindSwitchChange(e) {
    try {
      const enableRemind = e.detail.value;
      const app = getApp();
      // 更新数据库中的提醒开关状态
      await usersCol.where({ _openid: app.globalData.openid }).update({
        data: {
          enableRemind
        }
      });
      // 更新页面显示
      this.setData({
        'userInfo.enableRemind': enableRemind
      });
      // 提示用户操作结果
      wx.showToast({
        title: enableRemind ? '已开启提醒' : '已关闭提醒',
        icon: 'success'
      });
    } catch (err) {
      console.error('更新提醒开关失败：', err);
      wx.showToast({
        title: '操作失败，请重试',
        icon: 'none'
      });
    }
  },

  // 新增：分享功能 - 分享给好友
  onShareAppMessage() {
    return {
      title: '咱爸咱妈平安签，守护家人安全',
      path: '/pages/index/index'
    }
  },

  // 新增：分享功能 - 分享到朋友圈
  onShareTimeline() {
    return {
      title: '咱爸咱妈平安签，守护家人安全'
    }
  }
});