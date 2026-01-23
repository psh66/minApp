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
    // 新增：读取关怀模式设置
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
  },

  // 修复：加载天气数据（手动封装wx.request为Promise）
  async loadWeather() {
    try {
      // 1. 优先读取本地缓存（缓存1天）
      const cacheWeather = wx.getStorageSync("weatherCache");
      const cacheTime = wx.getStorageSync("weatherCacheTime");
      const now = Date.now();
      const ONE_DAY = 24 * 60 * 60 * 1000; // 1天毫秒数

      if (cacheWeather && cacheTime && now - cacheTime < ONE_DAY) {
        this.setData({
          todayWeather: cacheWeather.todayWeather,
          tomorrowWeather: cacheWeather.tomorrowWeather,
          day3Weather: cacheWeather.day3Weather,
          activeWeatherData: cacheWeather.todayWeather, // 默认选中今天
        });
        console.log("[天气模块] 已使用本地缓存数据（1天有效期）");
        return;
      }

      // 2. 获取用户定位（带授权判断）
      let locationRes;
      try {
        locationRes = await new Promise((resolve, reject) => {
          wx.getLocation({
            type: "gcj02", // 腾讯地图坐标系，适配和风接口
            success: resolve,
            fail: reject,
          });
        });
      } catch (locationErr) {
        // 定位失败：用户拒绝授权
        if (locationErr.errMsg.includes("auth deny")) {
          this.setData({ showLocationModal: true });
          // 用缓存兜底，无缓存则保持默认值
          if (cacheWeather) {
            this.setData({
              todayWeather: cacheWeather.todayWeather,
              tomorrowWeather: cacheWeather.tomorrowWeather,
              day3Weather: cacheWeather.day3Weather,
              activeWeatherData: cacheWeather.todayWeather,
            });
          }
          console.log("[天气模块] 用户拒绝定位授权，已显示引导弹窗");
          return;
        }
        // 其他定位失败（如网络问题）
        wx.showToast({ title: "定位失败，请稍后再试", icon: "none" });
        console.error("[天气模块] 定位失败：", locationErr);
        return;
      }

      // 3. 调用和风天气3天预报接口（修复：手动封装Promise）
      const { latitude, longitude } = locationRes;
      const weatherRes = await new Promise((resolve, reject) => {
        wx.request({
          url: `https://m87aar27kq.re.qweatherapi.com/v7/weather/3d`,
          data: {
            location: `${longitude},${latitude}`, // 经纬度格式：经度,纬度
            key: this.data.weatherApiKey,
          },
          method: "GET",
          success: resolve, // 成功时返回完整响应
          fail: reject, // 失败时捕获错误
        });
      });
      console.log("修复后 weatherRes：", weatherRes); // 打印完整响应

      // 4. 接口响应处理
      if (!weatherRes || !weatherRes.data) {
        wx.showToast({ title: "天气数据解析失败", icon: "none" });
        console.error("[天气模块] 响应数据为空");
        return;
      }

      if (weatherRes.statusCode !== 200) {
        wx.showToast({
          title: `天气请求失败（${weatherRes.statusCode || "未知状态码"}）`,
          icon: "none",
        });
        console.error("[天气模块] 接口状态码错误：", weatherRes.statusCode);
        return;
      }

      console.log("天气接口返回数据：", weatherRes.data);
      const { code, daily } = weatherRes.data;
      switch (code) {
        case "200":
          // 格式化3天天气数据
          const todayWeather = this.formatWeatherData(daily[0], "今天");
          const tomorrowWeather = this.formatWeatherData(daily[1], "明天");
          const day3Weather = this.formatWeatherData(daily[2], "后天");

          // 更新页面数据+写入缓存
          this.setData({
            todayWeather,
            tomorrowWeather,
            day3Weather,
            activeWeatherData: todayWeather,
          });
          wx.setStorageSync("weatherCache", {
            todayWeather,
            tomorrowWeather,
            day3Weather,
          });
          wx.setStorageSync("weatherCacheTime", now);
          console.log("[天气模块] 接口请求成功，已缓存1天");
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
      wx.showToast({ title: "天气加载异常，请稍后再试", icon: "none" });
      // 异常时用缓存兜底
      const cacheWeather = wx.getStorageSync("weatherCache");
      if (cacheWeather) {
        this.setData({
          todayWeather: cacheWeather.todayWeather,
          tomorrowWeather: cacheWeather.tomorrowWeather,
          day3Weather: cacheWeather.day3Weather,
          activeWeatherData: cacheWeather.todayWeather,
        });
      }
    }
  },

  // 格式化天气数据（适配接口返回格式，增加空值兜底）
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

  // 天气文字转emoji图标
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

  // 切换天气标签（今天/明天/后天）
  // 切换天气标签（今天/明天/后天）
  switchWeatherTab(e) {
    // 修复：确保从currentTarget.dataset中正确获取index（转成数字类型）
    const tabIndex = Number(e.currentTarget.dataset.index);
    let activeData = this.data.todayWeather;

    // 修复：明确匹配tabIndex对应的天气数据
    if (tabIndex === 1) {
      activeData = this.data.tomorrowWeather;
    } else if (tabIndex === 2) {
      activeData = this.data.day3Weather;
    } else {
      activeData = this.data.todayWeather;
    }

    // 修复：强制更新页面数据（确保页面重新渲染）
    this.setData(
      {
        currentWeatherTab: tabIndex,
        activeWeatherData: activeData,
      },
      () => {
        // 回调函数：确认数据已更新（可用于调试）
        console.log("天气标签切换成功，当前索引：", tabIndex);
      },
    );
  },

  // 打开天气详情弹窗
  openWeatherDetail() {
    this.setData({ showWeatherDetail: true });
  },

  // 关闭天气详情弹窗
  closeWeatherDetail() {
    this.setData({ showWeatherDetail: false });
  },

  // 定位授权引导-前往设置
  goToSetting() {
    this.setData({ showLocationModal: false });
    wx.openSetting({
      success: (res) => {
        // 用户开启定位权限后重新加载天气
        if (res.authSetting["scope.userLocation"]) {
          this.loadWeather();
        }
      },
    });
  },

  // 定位授权引导-取消
  cancelLocation() {
    this.setData({ showLocationModal: false });
  },

  // 新增：读取关怀模式本地缓存
  loadCareModeSetting() {
    try {
      const careMode = wx.getStorageSync("careMode") || false;
      const fontSizeMultiple = wx.getStorageSync("fontSizeMultiple") || 1.0;
      // 确保倍数在上下限范围内
      const validMultiple = Math.max(
        this.data.fontSizeMin,
        Math.min(this.data.fontSizeMax, fontSizeMultiple),
      );
      this.setData({
        careMode,
        fontSizeMultiple: validMultiple,
      });
    } catch (err) {
      console.error("读取关怀模式设置失败：", err);
    }
  },

  // 新增：页面显示时重新读取关怀模式
  onShow() {
    this.loadCareModeSetting();
  },

  // 原有方法：版本信息（无修改）
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
        });
      } else {
        const now = new Date();
        const trialEndTime = new Date(now);
        trialEndTime.setDate(trialEndTime.getDate() + 3);
        this.setData({
          serviceStartTime: this.formatDate(now),
          serviceEndTime: this.formatDate(trialEndTime),
          remainingTrialDays: 3,
        });
      }
    } catch (err) {
      console.error("获取版本信息失败：", err);
    }
  },

  // 原有方法：试用期检查（无修改）
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

  // 原有方法：日期格式化（无修改）
  formatDate(date) {
    date = new Date(date);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  // 原有方法：检查签到状态（无修改）
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

      const isSigned = res.data.length > 0;
      this.setData({ isSigned });
      wx.setStorageSync("isSignedToday", isSigned);
    } catch (err) {
      console.error("检查签到状态失败：", err);
    }
  },

  // 原有方法：签到（无修改）
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

  // 原有方法：获取联系人列表（无修改）
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

  // 原有方法：联系人表单输入（无修改）
  onFormChange(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail;
    this.setData({
      [`contactForm.${key}`]: value,
    });
  },

  // 原有方法：显示添加联系人弹窗（无修改）
  showAddDialog() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }
    this.setData({ showAddDialog: true });
  },

  // 原有方法：取消添加联系人（无修改）
  onCancelAddContact() {
    this.setData({
      showAddDialog: false,
      contactForm: { name: "", phone: "" },
    });
  },

  // 原有方法：确认添加联系人（无修改）
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

  // 原有方法：删除联系人（无修改）
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

  // 原有方法：检查用户邮箱（无修改）
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

  // 原有方法：邮箱输入（无修改）
  emailChange(e) {
    this.setData({ email: e.detail });
  },

  // 原有方法：显示添加邮箱弹窗（无修改）
  showEmailDialog() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }
    this.setData({ showEmailDialog: true });
  },

  // 原有方法：取消绑定邮箱（无修改）
  cancelBindEmail() {
    this.setData({ showEmailDialog: false, email: "" });
  },

  // 原有方法：绑定邮箱（无修改）
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

  // 原有方法：删除邮箱（无修改）
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

  // 原有方法：拨打电话（无修改）
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

  // 原有方法：姓名输入（无修改）
  onUserNameInput(e) {
    this.setData({ userName: e.detail.value });
  },

  // 原有方法：保存姓名（无修改）
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

  // 原有方法：设置家庭位置（无修改）
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

  // 原有方法：一键回家（无修改）
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

  // 原有方法：发送定位（无修改）
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

  // 原有方法：显示支付弹窗（无修改）
  showPayDialog() {
    this.setData({ showPayDialog: true });
  },

  // 原有方法：关闭支付弹窗（无修改）
  closePayDialog() {
    this.setData({ showPayDialog: false });
  },

  // 原有方法：选择支付类型（无修改）
  async choosePayType(e) {
    const type = e.currentTarget.dataset.type;
    const amount = type === "month" ? 3 : 20;

    try {
      const app = getApp();
      const res = await wx.cloud.callFunction({
        name: "createPayOrder",
        data: { openid: app.globalData.openid, payType: type, amount },
      });
      console.log("云函数返回：", res.result);

      if (res.result?.success) {
        const payParams = res.result.payParams;
        wx.requestPayment({
          ...payParams,
          success: async () => {
            await this.updateUserVersion(type);
            // 修复：区分升级/续费提示
            const toastTitle = this.data.isFormalVersion
              ? "续费成功，服务已延长"
              : "升级成功，已开通正式版";
            wx.showToast({ title: toastTitle });
            this.closePayDialog();
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
      // wx.hideLoading();
      console.error("支付失败：", err);
      wx.showToast({ title: "支付异常，请重试", icon: "none" });
    }
  },

  // 原有方法：更新用户版本（无修改）
  async updateUserVersion(payType) {
    try {
      const app = getApp();
      const now = new Date();
      const userRes = await usersCol
        .where({ _openid: app.globalData.openid })
        .get();

      let currentServiceEnd;
      if (userRes.data.length > 0) {
        // 有用户记录时，判断试用是否过期
        const userData = userRes.data[0];
        const trialEndTime = new Date(userData.serviceEndTime);
        // 未过期：用原结束时间；已过期：用当前时间
        currentServiceEnd = this.data.isTrialExpired ? now : trialEndTime;
      } else {
        // 无用户记录，用当前时间
        currentServiceEnd = now;
      }

      // 计算新的结束时间
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
      this.setData({ isTrialExpired: false });
    } catch (err) {
      console.error("更新版本失败：", err);
      wx.showToast({ title: "版本更新失败，请联系客服", icon: "none" });
    }
  },
});
