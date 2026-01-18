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
    validTimeText: '' // 存储格式化后的有效期文本
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad() {
    this.getUserInfo();
  },

  /**
   * 生命周期函数--监听页面显示（核心：切换到该页面时自动刷新）
   */
  onShow() {
    this.getUserInfo();
  },

  /**
   * 格式化服务有效期（JS内执行，可正常打印日志）
   */
  formatValidTime(startTime, endTime) {
    // 打印调试日志
    console.log('时间校验参数：', startTime, endTime);
    // 校验时间是否为有效字符串
    const isStartValid = startTime && !isNaN(new Date(startTime).getTime());
    const isEndValid = endTime && !isNaN(new Date(endTime).getTime());
    console.log('isStartValid', isStartValid, isEndValid);

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

  /**
   * 获取用户信息（强制拉取最新数据，多层兜底）
   */
  async getUserInfo() {
    try {
      const app = getApp();
      // 关键：force: true 强制从数据库拉取最新数据，避免缓存
      const res = await usersCol.where({ _openid: app.globalData.openid }).get({ force: true });
      
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
        
        // 6. 格式化有效期文本
        const validTimeText = this.formatValidTime(serviceStartTime, serviceEndTime);

        // 7. 更新页面数据
        this.setData({
          userName: user.name || '未设置昵称',
          isFormalVersion: isFormal,
          serviceStartTime,
          serviceEndTime,
          isTrialExpired,
          userTypeText,
          validTimeText
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

  /**
   * 格式化日期（统一格式，兜底非法日期）
   */
  formatDate(date) {
    date = new Date(date);
    if (isNaN(date.getTime())) date = new Date(); // 兜底
    return `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
  },

  /**
   * 跳转到版本管理页面
   */
  goToVersion() {
    wx.navigateTo({ url: '/pages/version/version' });
  },

  /**
   * 显示隐私弹窗
   */
  showPrivacyDialog() {
    this.setData({ showPrivacyDialog: true });
  },

  /**
   * 关闭隐私弹窗
   */
  closePrivacyDialog() {
    this.setData({ showPrivacyDialog: false });
  },

  /**
   * 显示关于弹窗
   */
  showAboutDialog() {
    this.setData({ showAboutDialog: true });
  },

  /**
   * 关闭关于弹窗
   */
  closeAboutDialog() {
    this.setData({ showAboutDialog: false });
  },

  /**
   * 联系客服
   */
  contactCustomer() {
    wx.showToast({ title: '正在打开客服会话', icon: 'none' });
    wx.openCustomerServiceChat({
      extInfo: { url: 'https://work.weixin.qq.com/kfid/kfc6f18280127625514' },
      fail: () => wx.showToast({ title: '打开客服失败', icon: 'none' })
    });
  },

  /**
   * 清除缓存
   */
  clearCache() {
    wx.clearStorageSync();
    wx.showToast({ title: '缓存已清除' });
  },

  /**
   * 退出登录
   */
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