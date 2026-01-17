const db = wx.cloud.database();
const contactsCol = db.collection('contacts');
const signCol = db.collection('signRecords');
const usersCol = db.collection('users');
// 新增：邮箱集合（用于存储多个邮箱）
const emailsCol = db.collection('emails');

Page({
  data: {
    isSigned: false,
    contactsList: [],
    showEmailDialog: false,
    showAddDialog: false,
    contactForm: { name: '', wechatId: '', phone: '' },
    email: '', // 临时存储待添加的邮箱
    emailList: [] // 存储多个邮箱的列表
  },

  onLoad() {
    // 优先读取本地缓存的签到状态，提升体验
    const isSignedCache = wx.getStorageSync('isSignedToday');
    if (isSignedCache) {
      this.setData({ isSigned: true });
    } else {
      this.checkSignStatus().catch(() => {});
    }
    this.checkUserEmail(); // 改为查询多邮箱列表
    this.getContactsList().catch(() => {});
  },

  // 修改：查询当前用户的所有邮箱（适配多邮箱）
  async checkUserEmail() {
    try {
      const app = getApp();
      // 从emails集合查询当前用户的所有邮箱
      const res = await emailsCol.where({ _openid: app.globalData.openid }).get();
      this.setData({ emailList: res.data });
    } catch (err) {
      console.error('查询邮箱列表失败：', err);
    }
  },

  // 邮箱输入变更（适配 Vant 1.x）
  emailChange(e) {
    this.setData({ email: e.detail });
  },

  // 显示邮箱绑定弹窗（直接打开，无授权校验）
  showEmailDialog() {
    this.setData({ showEmailDialog: true });
  },

  // 修改：添加邮箱（支持多个，不再覆盖）
  async bindEmail() {
    try {
      const app = getApp();
      const { email } = this.data;
      const emailReg = /^[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,4}$/;
      
      if (!email || !emailReg.test(email)) {
        return wx.showToast({ title: '邮箱格式错误', icon: 'none' });
      }

      // 新增邮箱到emails集合（不覆盖，直接新增）
      await emailsCol.add({ 
        data: { 
          email,
          createTime: db.serverDate() // 记录创建时间
        } 
      });
      
      wx.showToast({ title: '邮箱添加成功' });
      this.setData({ 
        showEmailDialog: false,
        email: '' // 清空输入框
      });
      this.checkUserEmail(); // 刷新邮箱列表
    } catch (err) {
      console.error('添加邮箱失败：', err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
  },

  // 取消绑定/添加邮箱
  cancelBindEmail() {
    this.setData({ 
      showEmailDialog: false,
      email: '' // 清空输入框
    });
  },

  // 新增：删除单个邮箱
  async deleteEmail(e) {
    try {
      const id = e.currentTarget.dataset.id;
      await emailsCol.doc(id).remove();
      wx.showToast({ title: '邮箱删除成功' });
      this.checkUserEmail(); // 刷新邮箱列表
    } catch (err) {
      console.error('删除邮箱失败：', err);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  // 检查今日签到状态
  async checkSignStatus() {
    try {
      const app = getApp();
      const today = new Date();
      // 精确设置今日 00:00 和明日 00:00 的时间戳
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
      
      const res = await signCol.where({
        openid: app.globalData.openid,
        signTime: db.command.gte(start).and(db.command.lt(end))
      }).get();
      const isSigned = res.data.length > 0;
      this.setData({ isSigned });
      // 同步到本地缓存
      wx.setStorageSync('isSignedToday', isSigned);
    } catch (err) {
      console.error('检查签到状态失败：', err);
      // 异常时默认设为未签到
      this.setData({ isSigned: false });
      wx.setStorageSync('isSignedToday', false);
    }
  },

  // 一键签到
  async handleSign() {
    try {
      const app = getApp();
      if (!app.globalData.openid) {
        return wx.showToast({ title: '签到失败：用户未登录', icon: 'none' });
      }
      await signCol.add({
        data: {
          signTime: new Date().getTime(), // 存储时间戳，方便查询
          createTime: db.serverDate(),
          openid: app.globalData.openid
        }
      });
      wx.showToast({ title: '签到成功' });
      // 强制更新状态并同步缓存
      this.setData({ isSigned: true });
      wx.setStorageSync('isSignedToday', true);
    } catch (err) {
      console.error('签到失败详细原因：', err);
      wx.showToast({ title: '签到失败，请稍后重试', icon: 'none' });
    }
  },

  // 获取联系人列表
  async getContactsList() {
    try {
      const app = getApp();
      const res = await contactsCol.where({ _openid: app.globalData.openid }).get();
      this.setData({ contactsList: res.data });
    } catch (err) {
      console.error('获取联系人列表失败：', err);
    }
  },

  // 拨打电话
  async callPhone(e) {
    try {
      const phone = e.currentTarget.dataset.phone;
      if (!phone) return wx.showToast({ title: '手机号为空', icon: 'none' });

      const emergencyPhones = ['110', '120', '119'];
      if (!emergencyPhones.includes(phone) && !/^1[3-9]\d{9}$/.test(phone)) {
        return wx.showToast({ title: '手机号格式错误', icon: 'none' });
      }

      wx.makePhoneCall({
        phoneNumber: phone,
        fail: (err) => {
          if (err.errMsg.includes('cancel')) {
            wx.showToast({ title: '已取消拨号', icon: 'none' });
          } else {
            wx.showToast({ title: '拨号失败', icon: 'none' });
          }
        }
      });
    } catch (err) {
      console.error('拨打电话失败：', err);
    }
  },

  // 显示添加联系人弹窗
  showAddDialog() {
    this.setData({ showAddDialog: true });
  },

  // 表单字段变更
  onFormChange(e) {
    const { key } = e.currentTarget.dataset;
    const value = e.detail;
    this.setData({
      [`contactForm.${key}`]: value
    });
  },

  // 确认添加联系人
  async onConfirmAddContact() {
    try {
      const app = getApp();
      const { name, phone } = this.data.contactForm;
      
      if (!name) return wx.showToast({ title: '请输入姓名', icon: 'none' });
      if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
        return wx.showToast({ title: '请输入正确的手机号', icon: 'none' });
      }
  
      await contactsCol.add({
        data: {
          name, phone,
          createTime: db.serverDate()
        }
      });
      wx.showToast({ title: '添加成功' });
      this.onCancelAddContact();
      this.getContactsList();
    } catch (err) {
      console.error('添加联系人失败：', err);
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
  },

  // 取消添加联系人
  onCancelAddContact() {
    this.setData({
      showAddDialog: false,
      contactForm: { name: '', wechatId: '', phone: '' }
    });
  },

  // 删除联系人
  async deleteContact(e) {
    try {
      const id = e.currentTarget.dataset.id;
      await contactsCol.doc(id).remove();
      wx.showToast({ title: '删除成功' });
      this.getContactsList();
    } catch (err) {
      console.error('删除联系人失败：', err);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  }
});