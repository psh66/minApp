const db = wx.cloud.database();
const contactsCol = db.collection('contacts');
const signCol = db.collection('signRecords');
const usersCol = db.collection('users');
const emailsCol = db.collection('emails');

Page({
  data: {
    isSigned: false,
    contactsList: [],
    showEmailDialog: false,
    showAddDialog: false,
    showPayDialog: false,
    contactForm: { name: '', phone: '' },
    email: '',
    emailList: [],
    userName: '',
    homeLocation: null,
    isFormalVersion: false,
    remainingTrialDays: 3,
    isTrialExpired: false,
    serviceStartTime: '',
    serviceEndTime: ''
  },

  onLoad() {
    const isSignedCache = wx.getStorageSync('isSignedToday');
    if (isSignedCache) this.setData({ isSigned: true });
    else this.checkSignStatus().catch(err => console.error(err));
    this.checkUserEmail();
    this.getContactsList();
    this.getVersionInfo();
    this.checkTrialExpired();
  },

  // 版本信息
  async getVersionInfo() {
    try {
      const app = getApp();
      const res = await usersCol.where({ _openid: app.globalData.openid }).get();
      if (res.data.length > 0) {
        const userInfo = res.data[0];
        const createTime = userInfo.createTime ? new Date(userInfo.createTime) : new Date();
        const trialEndTime = new Date(createTime);
        trialEndTime.setDate(trialEndTime.getDate() + 3);
        const remainingDays = Math.ceil((trialEndTime - new Date()) / (1000 * 60 * 60 * 24));
        this.setData({
          userName: userInfo.name || '',
          homeLocation: userInfo.homeLocation || null,
          isFormalVersion: userInfo.isFormalVersion || false,
          remainingTrialDays: remainingDays > 0 ? remainingDays : 0,
          serviceStartTime: userInfo.serviceStartTime ? this.formatDate(userInfo.serviceStartTime) : this.formatDate(createTime),
          serviceEndTime: userInfo.serviceEndTime ? this.formatDate(userInfo.serviceEndTime) : this.formatDate(trialEndTime)
        });
      } else {
        const now = new Date();
        const trialEndTime = new Date(now);
        trialEndTime.setDate(trialEndTime.getDate() + 3);
        this.setData({
          serviceStartTime: this.formatDate(now),
          serviceEndTime: this.formatDate(trialEndTime)
        });
      }
    } catch (err) {
      console.error('获取版本信息失败：', err);
    }
  },

  // 试用期检查
  async checkTrialExpired() {
    const { isFormalVersion, serviceEndTime } = this.data;
    if (!isFormalVersion) {
      const endDate = new Date(serviceEndTime);
      const now = new Date();
      const isExpired = now > endDate;
      this.setData({ isTrialExpired: isExpired });
      if (isExpired) {
        wx.showModal({
          title: '试用已到期',
          content: '请升级正式版继续使用全部功能',
          showCancel: false,
          success: () => this.showPayDialog()
        });
      }
    }
  },

  // 日期格式化
  formatDate(date) {
    date = new Date(date);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 签到
  async checkSignStatus() {
    try {
      const app = getApp();
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
      const res = await signCol.where({
        openid: app.globalData.openid,
        signTime: db.command.gte(start).and(db.command.lt(end))
      }).get();
      const isSigned = res.data.length > 0;
      this.setData({ isSigned });
      wx.setStorageSync('isSignedToday', isSigned);
    } catch (err) {
      console.error('检查签到状态失败：', err);
    }
  },

  async handleSign() {
    if (this.data.isTrialExpired) return wx.showToast({ title: '试用已到期，请升级', icon: 'none' });
    try {
      const app = getApp();
      await signCol.add({
        data: {
          openid: app.globalData.openid,
          signTime: new Date().getTime(),
          createTime: db.serverDate()
        }
      });
      this.setData({ isSigned: true });
      wx.setStorageSync('isSignedToday', true);
      wx.showToast({ title: '签到成功' });
    } catch (err) {
      console.error('签到失败：', err);
      wx.showToast({ title: '签到失败，请重试', icon: 'none' });
    }
  },

  // 联系人
  async getContactsList() {
    try {
      const app = getApp();
      const res = await contactsCol.where({ _openid: app.globalData.openid }).get();
      this.setData({ contactsList: res.data });
    } catch (err) {
      console.error('获取联系人失败：', err);
    }
  },

  onFormChange(e) {
    const key = e.currentTarget.dataset.key;
  const value = e.detail; // van-field的输入值在e.detail中，不是e.detail.value
  this.setData({
    [`contactForm.${key}`]: value
  });
  },

  showAddDialog() {
    if (this.data.isTrialExpired) return wx.showToast({ title: '试用已到期，请升级', icon: 'none' });
    this.setData({ showAddDialog: true });
  },

  onCancelAddContact() {
    this.setData({
      showAddDialog: false,
      contactForm: { name: '', phone: '' } // 重置表单
    });
  },

  async onConfirmAddContact() {
    if (this.data.isTrialExpired) return wx.showToast({ title: '试用已到期，请升级', icon: 'none' });
    try {
      const app = getApp();
      const { name, phone } = this.data.contactForm;
      console.log('name', name, phone); // 现在能正确打印输入值
      
      if (!name.trim()) return wx.showToast({ title: '请输入姓名', icon: 'none' });
      if (!/^1[3-9]\d{9}$/.test(phone)) return wx.showToast({ title: '手机号格式错误', icon: 'none' });
      
      await contactsCol.add({
        data: { name, phone, openid: app.globalData.openid, createTime: db.serverDate() }
      });
      wx.showToast({ title: '添加成功' });
      this.onCancelAddContact();
      this.getContactsList();
    } catch (err) {
      console.error('添加联系人失败：', err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
  },

  async deleteContact(e) {
    if (this.data.isTrialExpired) return wx.showToast({ title: '试用已到期，请升级', icon: 'none' });
    try {
      const id = e.currentTarget.dataset.id;
      await contactsCol.doc(id).remove();
      wx.showToast({ title: '删除成功' });
      this.getContactsList();
    } catch (err) {
      console.error('删除联系人失败：', err);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  // 邮箱
  async checkUserEmail() {
    try {
      const app = getApp();
      const res = await emailsCol.where({ _openid: app.globalData.openid }).get();
      this.setData({ emailList: res.data });
    } catch (err) {
      console.error('获取邮箱失败：', err);
    }
  },

  emailChange(e) {
    this.setData({
      email: e.detail // 关键：不是e.detail.value，直接取e.detail
    });
  },

  showEmailDialog() {
    if (this.data.isTrialExpired) return wx.showToast({ title: '试用已到期，请升级', icon: 'none' });
    this.setData({ showEmailDialog: true });
  },

  cancelBindEmail() {
    this.setData({ showEmailDialog: false, email: '' });
  },

  async bindEmail() {
    if (this.data.isTrialExpired) return wx.showToast({ title: '试用已到期，请升级', icon: 'none' });
    try {
      const app = getApp();
      const { email } = this.data;
      console.log('email', email); // 现在能正确打印输入的邮箱

      // 完善校验：空值+格式
      if (!email.trim()) return wx.showToast({ title: '请输入邮箱', icon: 'none' });
      // 更通用的邮箱正则
      const emailReg = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/;
      if (!emailReg.test(email)) return wx.showToast({ title: '邮箱格式错误', icon: 'none' });

      // 关键：移除_openid字段（云开发自动添加）
      await emailsCol.add({ 
        data: { 
          email, 
          openid: app.globalData.openid,
          createTime: db.serverDate() 
        } 
      });

      wx.showToast({ title: '添加成功' });
      this.cancelBindEmail();
      this.checkUserEmail();
    } catch (err) {
      console.error('添加邮箱失败：', err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
  },

  async deleteEmail(e) {
    if (this.data.isTrialExpired) return wx.showToast({ title: '试用已到期，请升级', icon: 'none' });
    try {
      const id = e.currentTarget.dataset.id;
      await emailsCol.doc(id).remove();
      wx.showToast({ title: '删除成功' });
      this.checkUserEmail();
    } catch (err) {
      console.error('删除邮箱失败：', err);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  // 拨打电话
  callPhone(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) return wx.showToast({ title: '手机号为空', icon: 'none' });
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: err => {
        if (err.errMsg.includes('cancel')) wx.showToast({ title: '已取消拨号', icon: 'none' });
        else wx.showToast({ title: '拨号失败', icon: 'none' });
      }
    });
  },

  // 备注
  onUserNameInput(e) {
    this.setData({ userName: e.detail.value });
  },

  async saveUserName() {
    if (this.data.isTrialExpired) return wx.showToast({ title: '试用已到期，请升级', icon: 'none' });
    try {
      const app = getApp();
      const { userName } = this.data;
      if (!userName.trim()) return wx.showToast({ title: '请输入姓名', icon: 'none' });
      const res = await usersCol.where({ _openid: app.globalData.openid }).get();
      if (res.data.length > 0) {
        await usersCol.doc(res.data[0]._id).update({ data: { name: userName } });
      } else {
        await usersCol.add({ data: { _openid: app.globalData.openid, name: userName, createTime: db.serverDate() } });
      }
      wx.showToast({ title: '保存成功' });
    } catch (err) {
      console.error('保存备注失败：', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // 家庭位置
  setHomeLocation() {
    if (this.data.isTrialExpired) return wx.showToast({ title: '试用已到期，请升级', icon: 'none' });
    wx.chooseLocation({
      success: async res => {
        const homeLocation = { lat: res.latitude, lng: res.longitude, address: res.address };
        try {
          const app = getApp();
          const userRes = await usersCol.where({ _openid: app.globalData.openid }).get();
          if (userRes.data.length > 0) {
            await usersCol.doc(userRes.data[0]._id).update({ data: { homeLocation } });
          } else {
            await usersCol.add({ data: { _openid: app.globalData.openid, homeLocation, createTime: db.serverDate() } });
          }
          this.setData({ homeLocation });
          wx.showToast({ title: '位置设置成功' });
        } catch (err) {
          console.error('保存位置失败：', err);
          wx.showToast({ title: '设置失败', icon: 'none' });
        }
      },
      fail: err => {
        if (err.errMsg.includes('auth deny')) {
          wx.showModal({
            title: '权限提示',
            content: '需要位置权限才能设置，请前往开启',
            confirmText: '去设置',
            success: res => {
              if (res.confirm) wx.openSetting({
                success: settingRes => {
                  if (settingRes.authSetting['scope.userLocation']) this.setHomeLocation();
                }
              });
            }
          });
        } else {
          wx.showToast({ title: '取消设置', icon: 'none' });
        }
      }
    });
  },

  // 一键回家
  goHome() {
    if (this.data.isTrialExpired) return wx.showToast({ title: '试用已到期，请升级', icon: 'none' });
    const { homeLocation } = this.data;
    if (!homeLocation) return wx.showModal({ title: '提示', content: '请先设置家庭位置', showCancel: false });
    wx.openLocation({
      latitude: homeLocation.lat,
      longitude: homeLocation.lng,
      name: '家',
      address: homeLocation.address,
      fail: () => wx.showToast({ title: '唤起导航失败', icon: 'none' })
    });
  },

  // 发送定位
  sendLocation() {
    if (this.data.isTrialExpired) return wx.showToast({ title: '试用已到期，请升级', icon: 'none' });
    if (this.data.emailList.length === 0) return wx.showToast({ title: '请先添加提醒邮箱', icon: 'none' });
    wx.getLocation({
      type: 'gcj02',
      success: async res => {
        const location = { lat: res.latitude, lng: res.longitude };
        try {
          const app = getApp();
          const sendRes = await wx.cloud.callFunction({
            name: 'sendLocationEmail',
            data: { location, emailList: this.data.emailList, userName: this.data.userName || '用户' }
          });
          if (sendRes.result.success) wx.showToast({ title: '定位邮件发送成功' });
          else wx.showToast({ title: '发送失败：' + sendRes.result.msg, icon: 'none' });
        } catch (err) {
          console.error('发送定位失败：', err);
          wx.showToast({ title: '发送失败', icon: 'none' });
        }
      },
      fail: err => {
        if (err.errMsg.includes('auth deny')) {
          wx.showModal({
            title: '权限提示',
            content: '需要位置权限才能发送，请前往开启',
            confirmText: '去设置',
            success: res => {
              if (res.confirm) wx.openSetting({
                success: settingRes => {
                  if (settingRes.authSetting['scope.userLocation']) this.sendLocation();
                }
              });
            }
          });
        } else {
          wx.showToast({ title: '获取位置失败', icon: 'none' });
        }
      }
    });
  },

  // 付费相关
  showPayDialog() {
    this.setData({ showPayDialog: true });
  },

  closePayDialog() {
    this.setData({ showPayDialog: false });
  },

  async choosePayType(e) {
    const type = e.currentTarget.dataset.type;
    const amount = type === 'month' ? 3 : 20;
    try {
      const app = getApp();
      const res = await wx.cloud.callFunction({
        name: 'createPayOrder',
        data: { openid: app.globalData.openid, payType: type, amount }
      });
      
      // 打印云函数返回结果（关键：看具体失败原因）
      console.log('云函数返回：', res.result);
      
      if (res.result.success) {
        const payParams = res.result.payParams;
        wx.requestPayment({
          ...payParams,
          success: async () => {
            await this.updateUserVersion(type);
            wx.showToast({ title: '支付成功' });
            this.closePayDialog();
          },
          fail: (payErr) => {
            console.error('支付请求失败：', payErr);
            wx.showToast({ title: '支付取消或失败', icon: 'none' });
          }
        });
      } else {
        // 显示具体失败原因
        wx.showToast({ title: `创建订单失败：${res.result.msg || '未知错误'}`, icon: 'none', duration: 3000 });
      }
    } catch (err) {
      console.error('支付失败：', err);
      wx.showToast({ title: '支付异常', icon: 'none' });
    }
  },

  async updateUserVersion(payType) {
    try {
      const app = getApp();
      const now = new Date();
      const serviceEndTime = new Date();
      serviceEndTime.setDate(payType === 'month' ? serviceEndTime.getDate() + 30 : serviceEndTime.getFullYear() + 1);
      const userRes = await usersCol.where({ _openid: app.globalData.openid }).get();
      if (userRes.data.length > 0) {
        await usersCol.doc(userRes.data[0]._id).update({
          data: {
            isFormalVersion: true,
            serviceEndTime: this.formatDate(serviceEndTime),
            payType,
            lastPayTime: db.serverDate()
          }
        });
      } else {
        await usersCol.add({
          data: {
            _openid: app.globalData.openid,
            isFormalVersion: true,
            serviceEndTime: this.formatDate(serviceEndTime),
            payType,
            lastPayTime: db.serverDate(),
            createTime: db.serverDate()
          }
        });
      }
      this.getVersionInfo();
    } catch (err) {
      console.error('更新版本失败：', err);
    }
  }
});