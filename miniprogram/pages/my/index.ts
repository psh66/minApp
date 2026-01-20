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
     userInfo: {}
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
        this.setData({
          userName: user.name || '未设置昵称',
          isFormalVersion: isFormal,
          serviceStartTime,
          serviceEndTime,
          isTrialExpired,
          userTypeText
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
  }
});