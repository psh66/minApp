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
    emailList: [], // 存储多个邮箱的列表
    // ========== 新增字段 ==========
    userName: '',          // 用户备注姓名
    homeLocation: null     // 存储家庭位置（经纬度+地址）
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
    // ========== 新增：加载用户备注和家庭位置 ==========
    this.getUserInfo();
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
          _openid: app.globalData.openid, // 补充openid字段，确保关联用户
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
          _openid: app.globalData.openid,
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
  },

  // ========== 新增：我的备注相关方法 ==========
  /**
   * 获取用户备注姓名和家庭位置
   */
  async getUserInfo() {
    try {
      const app = getApp();
      const res = await usersCol.where({
        _openid: app.globalData.openid
      }).get();
      if (res.data.length > 0) {
        this.setData({ 
          userName: res.data[0].name || '',
          homeLocation: res.data[0].homeLocation || null
        });
      }
    } catch (err) {
      console.error('获取用户信息失败：', err);
    }
  },

  /**
   * 输入备注姓名时的实时更新
   */
  onUserNameInput(e) {
    this.setData({ userName: e.detail.value });
  },

  /**
   * 保存备注姓名到数据库
   */
  async saveUserName() {
    try {
      const app = getApp();
      const { userName } = this.data;
      if (!userName.trim()) return wx.showToast({ title: '请输入姓名或简称', icon: 'none' });

      const res = await usersCol.where({
        _openid: app.globalData.openid
      }).get();

      if (res.data.length > 0) {
        // 更新已有用户的备注
        await usersCol.doc(res.data[0]._id).update({
          data: { name: userName }
        });
      } else {
        // 新增用户记录
        await usersCol.add({
          data: {
            _openid: app.globalData.openid,
            name: userName,
            createTime: db.serverDate()
          }
        });
      }

      wx.showToast({ title: '备注保存成功' });
    } catch (err) {
      console.error('保存备注失败：', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // ========== 新增：家庭位置相关方法 ==========
  /**
   * 设置家庭位置（唤起地图选择）
   */
  setHomeLocation() {
    wx.chooseLocation({
      success: async (res) => {
        const homeLocation = {
          lat: res.latitude,
          lng: res.longitude,
          address: res.address
        };
        try {
          const app = getApp();
          const userRes = await usersCol.where({
            _openid: app.globalData.openid
          }).get();
          if (userRes.data.length > 0) {
            // 更新已有用户的家庭位置
            await usersCol.doc(userRes.data[0]._id).update({
              data: { homeLocation }
            });
          } else {
            // 新增用户记录（含家庭位置）
            await usersCol.add({
              data: {
                _openid: app.globalData.openid,
                homeLocation,
                createTime: db.serverDate()
              }
            });
          }
          this.setData({ homeLocation });
          wx.showToast({ title: '家庭位置设置成功' });
        } catch (err) {
          console.error('保存家庭位置失败：', err);
          wx.showToast({ title: '设置失败', icon: 'none' });
        }
      },
      fail: (err) => {
        console.log('err',err)
        wx.showToast({ title: '取消设置位置', icon: 'none' });
      }
    });
  },

  // ========== 新增：紧急工具相关方法 ==========
  /**
   * 一键回家（唤起导航）
   */
  goHome() {
    const { homeLocation } = this.data;
    if (!homeLocation) {
      return wx.showModal({
        title: '提示',
        content: '请先设置家庭位置',
        showCancel: false
      });
    }

    wx.openLocation({
      latitude: homeLocation.lat,
      longitude: homeLocation.lng,
      name: '家',
      address: homeLocation.address,
      success: () => {
        console.log('已唤起导航');
      },
      fail: () => {
        wx.showToast({ title: '唤起导航失败', icon: 'none' });
      }
    });
  },

  /**
   * 一键发送定位（发送到绑定邮箱）
   */
  async sendLocation() {
    // 先获取用户实时定位
    wx.getLocation({
      type: 'gcj02', // 国测局坐标系，适配微信/高德地图
      success: async (res) => {
        const location = {
          lat: res.latitude,
          lng: res.longitude,
          address: res.address || '位置获取中'
        };

        // 校验是否有绑定邮箱
        if (!this.data.emailList || this.data.emailList.length === 0) {
          return wx.showToast({ title: '暂无绑定的提醒邮箱', icon: 'none' });
        }

        try {
          // 调用云函数发送定位邮件
          await wx.cloud.callFunction({
            name: 'sendLocationEmail',
            data: { 
              location, 
              emailList: this.data.emailList,
              userName: this.data.userName || '用户'
            }
          });
          wx.showToast({ title: '定位已发送' });
        } catch (err) {
          console.error('发送定位邮件失败：', err);
          wx.showToast({ title: '发送失败', icon: 'none' });
        }
      },
      fail: (err) => {
        console.error('获取定位失败：', err);
        wx.showToast({ title: '获取定位失败，请检查权限', icon: 'none' });
      }
    });
  }
});