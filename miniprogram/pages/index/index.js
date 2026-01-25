const db = wx.cloud.database();
const contactsCol = db.collection("contacts");
const signCol = db.collection("signRecords");
const usersCol = db.collection("users");
const emailsCol = db.collection("emails");

Page({
  data: {
    isSigned: false,
    contactsList: [],
    showEmailDialog: false,
    showAddDialog: false,
    showPayDialog: false,
    contactForm: { name: "", phone: "" },
    email: "",
    emailList: [],
    userName: "",
    homeLocation: null,
    isFormalVersion: false,
    remainingTrialDays: 3,
    isTrialExpired: false,
    serviceStartTime: "",
    serviceEndTime: "",
    // 新增：关怀模式相关字段
    careMode: false,
    fontSizeMultiple: 1.0,
    fontSizeMin: 0.8,
    fontSizeMax: 2.0,

    // 天气核心数据（含3天预报+详情字段）
    todayWeather: {
      dateText: "今天",
      temp: "--",
      desc: "加载中",
      icon: "🌤️",
      windDir: "--",
      windScale: "--",
      humidity: "--",
      uvIndex: "--",
      sunrise: "--",
      sunset: "--",
      precip: "--",
    },
    tomorrowWeather: {
      dateText: "明天",
      temp: "--",
      desc: "加载中",
      icon: "🌧️",
      windDir: "--",
      windScale: "--",
      humidity: "--",
      uvIndex: "--",
      sunrise: "--",
      sunset: "--",
      precip: "--",
    },
    day3Weather: {
      dateText: "后天",
      temp: "--",
      desc: "加载中",
      icon: "⛅",
      windDir: "--",
      windScale: "--",
      humidity: "--",
      uvIndex: "--",
      sunrise: "--",
      sunset: "--",
      precip: "--",
    },

    // 和风天气配置（替换为你自己的API Key）
    weatherApiKey: "06e8e23e12164644a95b6c77fdd15c0b",

    // 弹窗/切换状态控制
    showLocationModal: false, // 定位授权弹窗
    showWeatherDetail: false, // 天气详情弹窗
    currentWeatherTab: 0, // 0=今天/1=明天/2=后天
    activeWeatherData: {}, // 当前显示的天气数据（用于详情弹窗）

    // ========== 新增：父母/子女模式相关字段 ==========
    isChildMode: false, // 是否为子女模式
    showModeSheet: false, // 模式切换弹窗
    bindCode: "", // 父母绑定码
    parentSignStatus: false, // 父母今日签到状态
    parentSignHistory: [], // 父母7天签到历史
    // 新增：输入框聚焦状态（适配WXML高亮）
    focusUserName: false,
    focusEmail: false,
    focusContactName: false,
    focusContactPhone: false,
    focusBindCode: false,
    // 新增：关怀模式字体选项（保留原有fontSizeMultiple，新增选项列表）
    fontOptions: [
      { name: "标准字体", multiple: 1.0 },
      { name: "放大10%", multiple: 1.1 },
      { name: "放大20%", multiple: 1.2 },
      { name: "放大30%", multiple: 1.3 },
      { name: "放大40%", multiple: 1.4 },
    ],
    currentFontIndex: 0, // 当前选中字体索引
    // 新增：提醒开关
    enableRemind: false
  },

  onShareAppMessage() {
    return {
      title: "咱爸咱妈平安签，守护家人安全",
      path: "/pages/index/index",
      imageUrl: "../../images/001.jpg",
    };
  },

  onShareTimeline() {
    return {
      title: "咱爸咱妈平安签，守护家人安全",
      imageUrl: "../../images/001.jpg",
    };
  },

  async onLoad() {
    // ========== 新增：初始化全局模式数据 ==========
    const app = getApp();
    if (!app.globalData) {
      app.globalData = {
        currentMode: "parent",
        openid: "",
        bindParentOpenid: ""
      };
    }
    this.setData({
      isChildMode: app.globalData.currentMode === "child"
    });

    // 原有逻辑：读取关怀模式设置
    this.loadCareModeSetting();
    this.loadWeather(); // 初始化加载天气

    // 原有逻辑：先获取版本信息，再检查试用期
    await this.getVersionInfo();
    this.checkTrialExpired();

    // 检查签到状态
    const isSignedCache = wx.getStorageSync("isSignedToday");
    if (isSignedCache) {
      this.setData({ isSigned: true });
    } else {
      await this.checkSignStatus().catch((err) =>
        console.error("检查签到状态失败：", err),
      );
    }

    // 获取联系人、邮箱列表
    this.getContactsList();
    this.checkUserEmail();

    // ========== 新增：加载父母签到数据（子女模式下） ==========
    this.loadParentSignData();
  },

  // ========== 新增：页面显示时刷新模式和签到数据 ==========
  onShow() {
    const app = getApp();
    this.setData({
      isChildMode: app.globalData.currentMode === "child"
    });
    this.loadParentSignData();
    // 原有逻辑：刷新关怀模式和版本信息
    this.loadCareModeSetting();
    this.getVersionInfo();
  },

  // 原有方法：计算两点经纬度距离
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // 地球平均半径（公里）
    const radLat1 = Math.PI * lat1 / 180;
    const radLat2 = Math.PI * lat2 / 180;
    const a = radLat1 - radLat2;
    const b = Math.PI * lon1 / 180 - Math.PI * lon2 / 180;
    let s = 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(a/2), 2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b/2), 2)));
    s = s * R;
    return Math.round(s * 100) / 100; // 保留两位小数
  },

  // 原有方法：加载天气数据
  async loadWeather() {
    try {
      const DISTANCE_THRESHOLD = 20; // 触发更新的距离阈值：20公里
      const today = this.formatDate(new Date());
      const cacheInfo = wx.getStorageSync("weatherCacheInfo") || {};
      const { cacheDate, weatherData, cacheLat, cacheLon } = cacheInfo;

      // 1. 先获取当前定位
      let locationRes;
      try {
        locationRes = await new Promise((resolve, reject) => {
          wx.getLocation({
            type: "gcj02",
            success: resolve,
            fail: reject,
          });
        });
      } catch (locationErr) {
        if (locationErr.errMsg.includes("auth deny")) {
          this.setData({ showLocationModal: true });
          return;
        }
        wx.showToast({ title: "定位失败，请稍后再试", icon: "none" });
        console.error("[天气模块] 定位失败：", locationErr);
        return;
      }
      const { latitude: currentLat, longitude: currentLon } = locationRes;

      // 2. 判断缓存是否可用
      let isCacheValid = false;
      if (cacheDate === today && weatherData && cacheLat && cacheLon) {
        const distance = this.calculateDistance(cacheLat, cacheLon, currentLat, currentLon);
        isCacheValid = distance < DISTANCE_THRESHOLD;
        if (isCacheValid) {
          console.log(`[天气模块] 当前位置与缓存位置距离${distance}公里，复用缓存`);
        } else {
          console.log(`[天气模块] 当前位置与缓存位置距离${distance}公里，超过20公里阈值，重新请求`);
        }
      }

      // 3. 缓存可用则直接复用
      if (isCacheValid) {
        this.setData({
          todayWeather: weatherData.todayWeather,
          tomorrowWeather: weatherData.tomorrowWeather,
          day3Weather: weatherData.day3Weather,
          activeWeatherData: weatherData.todayWeather,
        });
        return;
      }

      // 4. 缓存不可用，请求天气接口
      const weatherRes = await new Promise((resolve, reject) => {
        wx.request({
          url: `https://m87aar27kq.re.qweatherapi.com/v7/weather/3d`,
          data: {
            location: `${currentLon},${currentLat}`,
            key: this.data.weatherApiKey,
          },
          method: "GET",
          success: resolve,
          fail: reject,
        });
      });

      // 5. 接口响应处理
      if (!weatherRes || !weatherRes.data) {
        wx.showToast({ title: "天气数据解析失败", icon: "none" });
        console.error("[天气模块] 响应数据为空");
        return;
      }
      if (weatherRes.statusCode !== 200) {
        wx.showToast({ title: `天气请求失败（${weatherRes.statusCode}）`, icon: "none" });
        console.error("[天气模块] 接口状态码错误：", weatherRes.statusCode);
        return;
      }

      const { code, daily } = weatherRes.data;
      switch (code) {
        case "200":
          const todayWeather = this.formatWeatherData(daily[0], "今天");
          const tomorrowWeather = this.formatWeatherData(daily[1], "明天");
          const day3Weather = this.formatWeatherData(daily[2], "后天");
          const newCacheInfo = {
            cacheDate: today,
            cacheLat: currentLat,
            cacheLon: currentLon,
            weatherData: { todayWeather, tomorrowWeather, day3Weather }
          };
          wx.setStorageSync("weatherCacheInfo", newCacheInfo);
          this.setData({ todayWeather, tomorrowWeather, day3Weather, activeWeatherData: todayWeather });
          console.log("[天气模块] 重新请求并缓存天气数据");
          break;
        case "401":
          wx.showToast({ title: "天气API Key无效，请检查配置", icon: "none" });
          console.error("[天气模块] 错误码401：API Key无效");
          break;
        case "429":
          wx.showToast({ title: "天气查询过于频繁，请明日再试", icon: "none" });
          console.error("[天气模块] 错误码429：请求频率超限");
          break;
        default:
          wx.showToast({ title: `天气获取失败（${code}）`, icon: "none" });
          console.error("[天气模块] 接口错误码：", code);
          break;
      }
    } catch (err) {
      console.error("[天气模块] 全局异常：", err);
      if (this.data.todayWeather.temp === "--") {
        wx.showToast({ title: "天气加载异常，请稍后再试", icon: "none" });
      }
    }
  },

  // 原有方法：日期格式化
  formatDate(date) {
    date = new Date(date);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  // 原有方法：格式化天气数据
  formatWeatherData(dailyData, dateText) {
    return {
      dateText,
      temp: `${dailyData.tempMin || "--"}~${dailyData.tempMax || "--"}℃`,
      desc: dailyData.textDay || "--",
      icon: this.getWeatherIcon(dailyData.textDay),
      windDir: dailyData.windDirDay || "--",
      windScale: dailyData.windScaleDay ? `${dailyData.windScaleDay}级` : "--",
      humidity: dailyData.humidity ? `${dailyData.humidity}%` : "--",
      uvIndex: dailyData.uvIndex ? `${dailyData.uvIndex}级` : "--",
      sunrise: dailyData.sunrise || "--",
      sunset: dailyData.sunset || "--",
      precip: dailyData.precip > 0 ? `${dailyData.precip}mm` : "无降水",
    };
  },

  // 原有方法：天气文字转图标
  getWeatherIcon(text) {
    const iconMap = {
      晴: "☀️",
      多云: "⛅",
      阴: "☁️",
      小雨: "🌧️",
      中雨: "🌧️",
      大雨: "🌧️",
      暴雨: "⛈️",
      雪: "❄️",
      雷阵雨: "⛈️",
      雨夹雪: "🌨️",
    };
    return iconMap[text] || "🌤️";
  },

  // 原有方法：切换天气标签
  switchWeatherTab(e) {
    const tabIndex = Number(e.currentTarget.dataset.index);
    let activeData = this.data.todayWeather;
    if (tabIndex === 1) {
      activeData = this.data.tomorrowWeather;
    } else if (tabIndex === 2) {
      activeData = this.data.day3Weather;
    }
    this.setData(
      {
        currentWeatherTab: tabIndex,
        activeWeatherData: activeData,
      },
      () => {
        console.log("天气标签切换成功，当前索引：", tabIndex);
      },
    );
  },

  // 原有方法：天气详情弹窗
  openWeatherDetail() {
    this.setData({ showWeatherDetail: true });
  },
  closeWeatherDetail() {
    this.setData({ showWeatherDetail: false });
  },

  // 原有方法：定位授权设置
  goToSetting() {
    this.setData({ showLocationModal: false });
    wx.openSetting({
      success: (res) => {
        if (res.authSetting["scope.userLocation"]) {
          this.loadWeather();
        }
      },
    });
  },
  cancelLocation() {
    this.setData({ showLocationModal: false });
  },

  // 原有方法：读取关怀模式设置
  loadCareModeSetting() {
    try {
      const careMode = wx.getStorageSync("careMode") || false;
      const fontSizeMultiple = wx.getStorageSync("fontSizeMultiple") || 1.0;
      const validMultiple = Math.max(
        this.data.fontSizeMin,
        Math.min(this.data.fontSizeMax, fontSizeMultiple),
      );
      // ========== 新增：计算字体选项索引 ==========
      const currentFontIndex = this.data.fontOptions.findIndex(item => 
        Math.abs(item.multiple - validMultiple) < 0.01
      ) || 0;
      this.setData({
        careMode,
        fontSizeMultiple: validMultiple,
        currentFontIndex
      });
    } catch (err) {
      console.error("读取关怀模式设置失败：", err);
    }
  },

  // 原有方法：页面显示时刷新数据
  async onShow() {
    this.loadCareModeSetting();
    await this.getVersionInfo();
    this.checkTrialExpired();
  },

  // 原有方法：获取版本信息
  async getVersionInfo() {
    try {
      const app = getApp();
      const res = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();

      if (res.data.length > 0) {
        const userInfo = res.data[0];
        const createTime = userInfo.createTime
          ? new Date(userInfo.createTime)
          : new Date();
        const isFormal = userInfo.isFormalVersion || false;

        const trialEndTime = new Date(createTime);
        trialEndTime.setDate(trialEndTime.getDate() + 3);
        const remainingDays = isFormal
          ? 0
          : Math.ceil((trialEndTime - new Date()) / (1000 * 60 * 60 * 24));

        this.setData({
          userName: userInfo.name || "",
          homeLocation: userInfo.homeLocation || null,
          isFormalVersion: isFormal,
          remainingTrialDays: remainingDays > 0 ? remainingDays : 0,
          serviceStartTime:
            userInfo.serviceStartTime || this.formatDate(createTime),
          serviceEndTime:
            userInfo.serviceEndTime || this.formatDate(trialEndTime),
          // ========== 新增：读取提醒开关状态 ==========
          enableRemind: userInfo.enableRemind || false
        });
      } else {
        const now = new Date();
        const trialEndTime = new Date(now);
        trialEndTime.setDate(trialEndTime.getDate() + 3);
        this.setData({
          serviceStartTime: this.formatDate(now),
          serviceEndTime: this.formatDate(trialEndTime),
          remainingTrialDays: 3,
          enableRemind: false
        });
      }
    } catch (err) {
      console.error("获取版本信息失败：", err);
    }
  },

  // 原有方法：检查试用期
  async checkTrialExpired() {
    const { isFormalVersion, serviceEndTime } = this.data;
    if (!isFormalVersion) {
      const endDate = new Date(serviceEndTime);
      const now = new Date();
      const isExpired = now > endDate;
      this.setData({ isTrialExpired: isExpired });

      if (isExpired) {
        wx.showModal({
          title: "试用已到期",
          content: "您的3天试用已结束，升级正式版后可继续使用全部功能",
          showCancel: false,
          success: () => this.showPayDialog(),
        });
      }
    }
  },

  // 原有方法：检查签到状态
  async checkSignStatus() {
    try {
      const app = getApp();
      const today = new Date();
      const start = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
      ).getTime();
      const end = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() + 1,
      ).getTime();

      const res = await signCol
        .where({
          openid: app.globalData.openid,
          signTime: db.command.gte(start).and(db.command.lt(end)),
          _openid: app.globalData.openid,
        })
        .get();
      console.log("签到状态：", res);
      const isSigned = res.data.length > 0;
      this.setData({ isSigned });
      wx.setStorageSync("isSignedToday", isSigned);
    } catch (err) {
      console.error("检查签到状态失败：", err);
    }
  },

  // 原有方法：签到
  async handleSign() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }
    if (this.data.isSigned) {
      return wx.showToast({ title: "今日已签到", icon: "none" });
    }

    try {
      const app = getApp();
      await signCol.add({
        data: {
          openid: app.globalData.openid,
          signTime: new Date().getTime(),
          createTime: db.serverDate(),
        },
      });
      this.setData({ isSigned: true });
      wx.setStorageSync("isSignedToday", true);
      wx.showToast({ title: "签到成功" });
    } catch (err) {
      console.error("签到失败：", err);
      wx.showToast({ title: "签到失败，请重试", icon: "none" });
    }
  },

  // 原有方法：获取联系人列表
  async getContactsList() {
    try {
      const app = getApp();
      const res = await contactsCol
        .where({ _openid: app.globalData.openid })
        .get();
      this.setData({ contactsList: res.data });
    } catch (err) {
      console.error("获取联系人失败：", err);
      wx.showToast({ title: "加载联系人失败", icon: "none" });
    }
  },

  // 原有方法：联系人表单输入
  onFormChange(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail;
    this.setData({
      [`contactForm.${key}`]: value,
    });
  },

  // 原有方法：显示添加联系人弹窗
  showAddDialog() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }
    this.setData({ showAddDialog: true });
  },

  // 原有方法：取消添加联系人
  onCancelAddContact() {
    this.setData({
      showAddDialog: false,
      contactForm: { name: "", phone: "" },
    });
  },

  // 原有方法：确认添加联系人
  async onConfirmAddContact() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const app = getApp();
      const { name, phone } = this.data.contactForm;

      if (!name.trim()) {
        return wx.showToast({ title: "请输入联系人姓名", icon: "none" });
      }
      if (!phone.trim()) {
        return wx.showToast({ title: "请输入手机号", icon: "none" });
      }
      const phoneReg = /^1[3-9]\d{9}$/;
      if (!phoneReg.test(phone)) {
        return wx.showToast({ title: "请输入正确的11位手机号", icon: "none" });
      }

      await contactsCol.add({
        data: {
          name: name.trim(),
          phone: phone.trim(),
          openid: app.globalData.openid,
          createTime: db.serverDate(),
        },
      });

      wx.showToast({ title: "联系人添加成功" });
      this.onCancelAddContact();
      this.getContactsList();
    } catch (err) {
      console.error("添加联系人失败：", err);
      wx.showToast({ title: "添加失败，请重试", icon: "none" });
    }
  },

  // 原有方法：删除联系人
  async deleteContact(e) {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const id = e.currentTarget.dataset.id;
      await contactsCol.doc(id).remove();
      wx.showToast({ title: "联系人删除成功" });
      this.getContactsList();
    } catch (err) {
      console.error("删除联系人失败：", err);
      wx.showToast({ title: "删除失败，请重试", icon: "none" });
    }
  },

  // 原有方法：检查用户邮箱
  async checkUserEmail() {
    try {
      const app = getApp();
      const res = await emailsCol
        .where({ _openid: app.globalData.openid })
        .get();
      this.setData({ emailList: res.data });
    } catch (err) {
      console.error("获取邮箱失败：", err);
      wx.showToast({ title: "加载邮箱列表失败", icon: "none" });
    }
  },

  // 原有方法：邮箱输入
  emailChange(e) {
    this.setData({ email: e.detail });
  },

  // 原有方法：显示添加邮箱弹窗
  showEmailDialog() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }
    this.setData({ showEmailDialog: true });
  },

  // 原有方法：取消绑定邮箱
  cancelBindEmail() {
    this.setData({ showEmailDialog: false, email: "" });
  },

  // 原有方法：绑定邮箱
  async bindEmail() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const app = getApp();
      const { email } = this.data;

      if (!email.trim()) {
        return wx.showToast({ title: "请输入邮箱地址", icon: "none" });
      }
      const emailReg = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/;
      if (!emailReg.test(email)) {
        return wx.showToast({ title: "请输入正确的邮箱格式", icon: "none" });
      }

      const hasEmail = this.data.emailList.some(
        (item) => item.email === email.trim(),
      );
      if (hasEmail) {
        return wx.showToast({ title: "该邮箱已添加", icon: "none" });
      }

      await emailsCol.add({
        data: {
          email: email.trim(),
          openid: app.globalData.openid,
          createTime: db.serverDate(),
        },
      });

      wx.showToast({ title: "邮箱添加成功" });
      this.cancelBindEmail();
      this.checkUserEmail();
    } catch (err) {
      console.error("添加邮箱失败：", err);
      wx.showToast({ title: "添加失败，请重试", icon: "none" });
    }
  },

  // 原有方法：删除邮箱
  async deleteEmail(e) {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const id = e.currentTarget.dataset.id;
      await emailsCol.doc(id).remove();
      wx.showToast({ title: "邮箱删除成功" });
      this.checkUserEmail();
    } catch (err) {
      console.error("删除邮箱失败：", err);
      wx.showToast({ title: "删除失败，请重试", icon: "none" });
    }
  },

  // 原有方法：拨打电话
  callPhone(e) {
    const phone = e.currentTarget.dataset.phone;
    if (!phone) {
      return wx.showToast({ title: "手机号为空", icon: "none" });
    }
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: (err) => {
        if (err.errMsg.includes("cancel")) {
          wx.showToast({ title: "已取消拨号", icon: "none" });
        } else {
          wx.showToast({ title: "拨号失败，请重试", icon: "none" });
        }
      },
    });
  },

  // 原有方法：姓名输入
  onUserNameInput(e) {
    this.setData({ userName: e.detail.value });
  },

  // 原有方法：保存姓名
  async saveUserName() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const app = getApp();
      const { userName } = this.data;

      if (!userName.trim()) {
        return wx.showToast({ title: "请输入姓名", icon: "none" });
      }

      const res = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();
      if (res.data.length > 0) {
        await usersCol
          .doc(res.data[0]._id)
          .update({ data: { name: userName.trim() } });
      } else {
        await usersCol.add({
          data: {
            name: userName.trim(),
            createTime: db.serverDate(),
            _openid: app.globalData.openid,
          },
        });
      }

      wx.showToast({ title: "姓名保存成功" });
    } catch (err) {
      console.error("保存备注失败：", err);
      wx.showToast({ title: "保存失败，请重试", icon: "none" });
    }
  },

  // 原有方法：设置家庭位置
  setHomeLocation() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    wx.chooseLocation({
      success: async (res) => {
        const homeLocation = {
          lat: res.latitude,
          lng: res.longitude,
          address: res.address,
        };
        try {
          const app = getApp();
          const userRes = await usersCol
            .where({ _openid: app.globalData.openid })
            .get();

          if (userRes.data.length > 0) {
            await usersCol
              .doc(userRes.data[0]._id)
              .update({ data: { homeLocation } });
          } else {
            await usersCol.add({
              data: {
                homeLocation,
                createTime: db.serverDate(),
                _openid: app.globalData.openid,
              },
            });
          }

          this.setData({ homeLocation });
          wx.showToast({ title: "家庭位置设置成功" });
        } catch (err) {
          console.error("保存位置失败：", err);
          wx.showToast({ title: "设置失败，请重试", icon: "none" });
        }
      },
      fail: (err) => {
        if (err.errMsg.includes("auth deny")) {
          wx.showModal({
            title: "权限提示",
            content: "需要获取您的位置权限才能设置家庭位置，请前往开启",
            confirmText: "去设置",
            cancelText: "取消",
            success: (res) => {
              if (res.confirm) {
                wx.openSetting({
                  success: (settingRes) => {
                    if (settingRes.authSetting["scope.userLocation"]) {
                      this.setHomeLocation();
                    }
                  },
                });
              }
            },
          });
        } else if (!err.errMsg.includes("cancel")) {
          wx.showToast({ title: "获取位置失败，请重试", icon: "none" });
        }
      },
    });
  },

  // 原有方法：一键回家
  goHome() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    const { homeLocation } = this.data;
    if (!homeLocation) {
      return wx.showModal({
        title: "提示",
        content: "请先设置家庭位置",
        showCancel: false,
        confirmText: "去设置",
      });
    }

    wx.openLocation({
      latitude: homeLocation.lat,
      longitude: homeLocation.lng,
      name: "家",
      address: homeLocation.address,
      fail: () => wx.showToast({ title: "唤起导航失败，请重试", icon: "none" }),
    });
  },

  // 原有方法：发送定位
  sendLocation() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    if (this.data.emailList.length === 0) {
      return wx.showModal({
        title: "提示",
        content: "请先添加提醒邮箱，定位将发送至该邮箱",
        showCancel: false,
        confirmText: "去添加",
      });
    }

    wx.getLocation({
      type: "gcj02",
      success: async (res) => {
        const location = { lat: res.latitude, lng: res.longitude };
        try {
          wx.showLoading({ title: "发送中..." });
          const app = getApp();
          const sendRes = await wx.cloud.callFunction({
            name: "sendLocationEmail",
            data: {
              location,
              emailList: this.data.emailList,
              userName: this.data.userName || "用户",
            },
          });
          wx.hideLoading();

          if (sendRes.result?.success) {
            wx.showToast({ title: "定位邮件发送成功" });
          } else {
            wx.showToast({
              title: `发送失败：${sendRes.result?.msg || "服务器异常"}`,
              icon: "none",
              duration: 3000,
            });
          }
        } catch (err) {
          wx.hideLoading();
          console.error("发送定位失败：", err);
          wx.showToast({ title: "发送失败，请重试", icon: "none" });
        }
      },
      fail: (err) => {
        if (err.errMsg.includes("auth deny")) {
          wx.showModal({
            title: "权限提示",
            content: "需要获取您的位置权限才能发送定位，请前往开启",
            confirmText: "去设置",
            cancelText: "取消",
            success: (res) => {
              if (res.confirm) {
                wx.openSetting({
                  success: (settingRes) => {
                    if (settingRes.authSetting["scope.userLocation"]) {
                      this.sendLocation();
                    }
                  },
                });
              }
            },
          });
        } else if (!err.errMsg.includes("cancel")) {
          wx.showToast({ title: "获取位置失败，请重试", icon: "none" });
        }
      },
    });
  },

  // 原有方法：显示支付弹窗
  showPayDialog() {
    this.setData({ showPayDialog: true });
  },

  // 原有方法：关闭支付弹窗
  closePayDialog() {
    this.setData({ showPayDialog: false });
  },

  // 原有方法：选择支付类型
  async choosePayType(e) {
    const type = e.currentTarget.dataset.type;
    const amount = type === "month" ? 3 : 20;

    try {
      wx.showLoading({ title: "创建订单中..." });
      const app = getApp();
      const res = await wx.cloud.callFunction({
        name: "createPayOrder",
        data: { openid: app.globalData.openid, payType: type, amount },
      });
      console.log("云函数返回：", res.result);
      wx.hideLoading();
      if (res.result?.success) {
        const payParams = res.result.payParams;
        wx.requestPayment({
          ...payParams,
          success: async () => {
            await this.updateUserVersion(type);
            const toastTitle = this.data.isFormalVersion
              ? "续费成功，服务已延长"
              : "升级成功，已开通正式版";
            wx.showToast({ title: toastTitle });
            this.closePayDialog();
            await this.getVersionInfo();
            this.checkTrialExpired();
            this.setData({ isTrialExpired: false });
          },
          fail: (payErr) => {
            console.error("支付请求失败：", payErr);
            wx.showToast({
              title: payErr.errMsg.includes("cancel")
                ? "已取消支付"
                : "支付失败",
              icon: "none",
            });
          },
        });
      } else {
        wx.showToast({
          title: `创建订单失败：${res.result?.msg || "未知错误"}`,
          icon: "none",
          duration: 3000,
        });
      }
    } catch (err) {
      wx.hideLoading();
      console.error("支付失败：", err);
      wx.showToast({ title: "支付异常，请重试", icon: "none" });
    }
  },

  // 原有方法：更新用户版本
  async updateUserVersion(payType) {
    try {
      const app = getApp();
      const now = new Date();
      const userRes = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();

      let currentServiceEnd;
      if (userRes.data.length > 0) {
        const userData = userRes.data[0];
        const trialEndTime = new Date(userData.serviceEndTime);
        currentServiceEnd = this.data.isTrialExpired ? now : trialEndTime;
      } else {
        currentServiceEnd = now;
      }

      let serviceEndTime = new Date(currentServiceEnd);
      if (payType === "month") {
        serviceEndTime.setDate(serviceEndTime.getDate() + 30);
      } else {
        serviceEndTime.setFullYear(serviceEndTime.getFullYear() + 1);
      }

      const updateData = {
        isFormalVersion: true,
        serviceStartTime: this.formatDate(now),
        serviceEndTime: this.formatDate(serviceEndTime),
        payType,
        lastPayTime: db.serverDate(),
        trialExpired: false,
        isTrialExpired: false,
      };

      if (userRes.data.length > 0) {
        await usersCol.doc(userRes.data[0]._id).update({ data: updateData });
      } else {
        await usersCol.add({
          data: {
            _openid: app.globalData.openid,
            ...updateData,
            createTime: db.serverDate(),
          },
        });
      }

      await this.getVersionInfo();
      this.checkTrialExpired();
      this.setData({
        isTrialExpired: false,
        isFormalVersion: true,
      });
    } catch (err) {
      console.error("更新版本失败：", err);
      wx.showToast({ title: "版本更新失败，请联系客服", icon: "none" });
    }
  },

  // ========== 新增：父母/子女模式切换核心方法 ==========
  // 1. 显示模式切换弹窗
  showModeSwitchSheet() {
    this.setData({ showModeSheet: true });
  },

  // 2. 取消模式切换
  cancelModeSwitch() {
    this.setData({ 
      showModeSheet: false, 
      bindCode: "",
      focusBindCode: false
    });
  },

  // 3. 绑定码输入
  onBindCodeInput(e) {
    this.setData({ bindCode: e.detail.value });
  },

  // 4. 输入框聚焦/失焦事件
  onBindCodeFocus() {
    this.setData({ focusBindCode: true });
  },
  onBindCodeBlur() {
    this.setData({ focusBindCode: false });
  },
  onUserNameFocus() {
    this.setData({ focusUserName: true });
  },
  onUserNameBlur() {
    this.setData({ focusUserName: false });
  },
  onContactNameFocus() {
    this.setData({ focusContactName: true });
  },
  onContactNameBlur() {
    this.setData({ focusContactName: false });
  },
  onContactPhoneFocus() {
    this.setData({ focusContactPhone: true });
  },
  onContactPhoneBlur() {
    this.setData({ focusContactPhone: false });
  },
  onEmailFocus() {
    this.setData({ focusEmail: true });
  },
  onEmailBlur() {
    this.setData({ focusEmail: false });
  },

// 5. 确认模式切换（调用云函数版）
confirmModeSwitch() {
  const { isChildMode, bindCode } = this.data;
  const app = getApp();

  this.setData({ showModeSheet: false });

  if (!isChildMode) {
    // 切换到子女模式：验证6位绑定码
    if (!bindCode || bindCode.length !== 6) {
      wx.showToast({ title: "请输入6位父母绑定码", icon: "none" });
      return;
    }

    wx.showLoading({ title: "验证中..." });

    // 调用云函数验证绑定码
    wx.cloud.callFunction({
      name: 'checkBindCode',
      data: { bindCode },
      success: (res) => {
        wx.hideLoading();
        const result = res.result;
        if (result.success) {
          console.log("验证成功---：", result);
          // 验证成功，切换模式
          app.globalData.currentMode = "child";
          app.globalData.bindParentOpenid = result.parentOpenid;
          app.globalData.bindParentInfo = result.parentInfo;
          this.setData({ 
            isChildMode: true, 
            bindParentInfo: result.parentInfo 
          });
          wx.showToast({ title: "已切换至子女模式", icon: "success" });
          this.loadParentSignData();
        } else {
          wx.showToast({ title: result.errMsg, icon: "none" });
        }
      },
      fail: (err) => {
        wx.hideLoading();
        console.error("调用云函数失败：", err);
        wx.showToast({ title: "切换失败，请重试", icon: "none" });
      }
    });
  } else {
    // 切换回父母模式（逻辑和原来一致）
    app.globalData.currentMode = "parent";
    app.globalData.bindParentOpenid = "";
    app.globalData.bindParentInfo = null;
    this.setData({ isChildMode: false });
    wx.showToast({ title: "已切换至父母模式", icon: "success" });
    this.checkSignStatus();
  }
},

// 6. 加载父母签到数据
// loadParentSignData() {
//   const { isChildMode } = this.data;
//   const app = getApp();
//   // 非子女模式/未绑定父母openid，直接返回
//   if (!isChildMode || !app.globalData.bindParentOpenid) {
//     return;
//   }

//   // 打印关键参数用于调试
//   console.log("【父母签到查询】绑定的openid：", app.globalData.bindParentOpenid);
  
//   // ========== 1. 计算今日时间区间（本地时间0点-24点） ==========
//   const today = new Date();
//   const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
//   const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
//   console.log("【父母签到查询】今日区间：", todayStart, "~", todayEnd);

//   // ========== 2. 查询父母今日签到状态 ==========
//   signCol.where({
//     _openid: app.globalData.bindParentOpenid, // 统一用数据库里的 _openid 字段
//     signTime: db.command.gte(todayStart).and(db.command.lt(todayEnd))
//   }).get().then(todayRes => {
//     const isTodaySigned = todayRes.data.length > 0;
//     console.log("【父母签到查询】今日状态：", isTodaySigned, "，原始数据：", todayRes.data);
//     this.setData({ parentSignStatus: isTodaySigned });

//     // ========== 3. 计算最近7天日期 ==========
//     const last7Days = [];
//     for (let i = 6; i >= 0; i--) {
//       const date = new Date();
//       date.setDate(today.getDate() - i);
//       last7Days.push(this.formatDate(date));
//     }
//     console.log("【父母签到查询】最近7天日期：", last7Days);

//     // ========== 4. 批量查询7天签到历史 ==========
//     const historyPromises = last7Days.map(dateStr => {
//       const [year, month, day] = dateStr.split('-').map(Number);
//       const dayStart = new Date(year, month - 1, day).getTime();
//       const dayEnd = new Date(year, month - 1, day + 1).getTime();
//       console.log(`【父母签到查询】${dateStr} 区间：`, dayStart, "~", dayEnd);
      
//       return signCol.where({
//         _openid: app.globalData.bindParentOpenid,
//         signTime: db.command.gte(dayStart).and(db.command.lt(dayEnd))
//       }).get();
//     });

//     // ========== 5. 处理7天查询结果 ==========
//     Promise.all(historyPromises).then(results => {
//       const parentSignHistory = last7Days.map((date, index) => ({
//         date,
//         isSigned: results[index].data.length > 0
//       }));
//       console.log("【父母签到查询】7天历史：", parentSignHistory);
//       this.setData({ parentSignHistory });
//     });
//   }).catch(err => {
//     console.error("【父母签到查询】失败：", err);
//     wx.showToast({ title: "加载父母签到数据失败", icon: "none" });
//   });
// },
loadParentSignData() {
  const { isChildMode } = this.data;
  const app = getApp();
  
  // ========== 强制锁定正确的父母openid（测试用） ==========
  const targetParentOpenid = "o55dP112xdklRsj-6_eVlSI3oD3Q";
  app.globalData.bindParentOpenid = targetParentOpenid; // 强制赋值
  
  // 打印完整的全局数据，看是否有其他值干扰
  console.log("【全局数据完整快照】", JSON.stringify(app.globalData));
  
  if (!isChildMode || !app.globalData.bindParentOpenid) {
    return;
  }

  // 后续查询逻辑不变，但所有查询都用 targetParentOpenid 替代 app.globalData.bindParentOpenid
  console.log("【父母签到查询】绑定的openid：", targetParentOpenid);
  
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  
  // 查询时直接用锁定的 targetParentOpenid
  // signCol.where({
  //   _openid: targetParentOpenid, // 不再用 app.globalData.bindParentOpenid
  //   signTime: db.command.gte(todayStart).and(db.command.lt(todayEnd))
  // }).get().then(todayRes => {
  //   console.log("【强制锁定openid查询结果】", todayRes.data);
  //   // 后续逻辑不变
  // });
  signCol.where({
  _openid: "o55dP112xdklRsj-6_eVlSI3oD3Q", // 直接写死，不依赖任何变量
  signTime: db.command.gte(todayStart).and(db.command.lt(todayEnd))
}).get().then(todayRes => {
  console.log("【硬编码查询结果】", todayRes.data);
}); 
},

// 辅助方法：确保日期格式化正确（补零）
formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
},

  // ========== 新增：提醒开关切换 ==========
  onRemindSwitchChange(e) {
    const enableRemind = e.detail.value;
    const app = getApp();
    usersCol.where({ _openid: app.globalData.openid }).get().then(res => {
      if (res.data.length > 0) {
        usersCol.doc(res.data[0]._id).update({
          data: { enableRemind }
        }).then(() => {
          this.setData({ enableRemind });
          wx.showToast({ title: enableRemind ? "已开启签到提醒" : "已关闭签到提醒" });
        });
      }
    }).catch(err => {
      console.error("更新提醒开关失败：", err);
      wx.showToast({ title: "设置失败", icon: "none" });
    });
  }
});