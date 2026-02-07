const db = wx.cloud.database();
const contactsCol = db.collection("contacts");
const signCol = db.collection("signRecords");
const usersCol = db.collection("users");
const emailsCol = db.collection("emails");
const bindRelationsCol = db.collection("bindRelations");

Page({
  data: {
    notice: {
      showNotice: false,
      noticeContent: "",
    },
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
    careMode: false,
    fontSizeMultiple: 1.0,
    fontSizeMin: 0.8,
    fontSizeMax: 2.0,
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
    weatherApiKey: "06e8e23e12164644a95b6c77fdd15c0b",
    showLocationModal: false,
    showWeatherDetail: false,
    currentWeatherTab: 0,
    activeWeatherData: {},
    isChildMode: false,
    showModeSheet: false,
    bindCode: "",
    parentSignStatus: false,
    parentSignHistory: [],
    focusUserName: false,
    focusEmail: false,
    focusContactName: false,
    focusContactPhone: false,
    focusBindCode: false,
    fontOptions: [
      { name: "标准字体", multiple: 1.0 },
      { name: "放大10%", multiple: 1.1 },
      { name: "放大20%", multiple: 1.2 },
      { name: "放大30%", multiple: 1.3 },
      { name: "放大40%", multiple: 1.4 },
    ],
    currentFontIndex: 0,
    enableRemind: false,
    weatherList: [],
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

  // 权限校验通用方法
  async checkChildPermission(targetOpenid) {
    const app = getApp();
    if (!this.data.isChildMode) return true;

    try {
      const bindRes = await bindRelationsCol.doc(app.globalData.openid).get();
      if (!bindRes.data) {
        wx.showToast({ title: "未绑定父母账号，请重新绑定", icon: "none" });
        return false;
      }
      if (bindRes.data.parentOpenid !== targetOpenid) {
        wx.showToast({ title: "无权限操作该父母数据", icon: "none" });
        return false;
      }
      return true;
    } catch (err) {
      console.error("权限校验失败：", err);
      wx.showToast({ title: `校验失败：${err.errMsg}`, icon: "none" });
      return false;
    }
  },

  // 新增：加载目标用户配置（邮件提醒+关怀模式，与我的页面同步）
  async loadTargetUserConfig() {
    const app = getApp();
    const targetOpenid = this.data.isChildMode
      ? app.globalData.bindParentOpenid
      : app.globalData.openid;

    try {
      const res = await usersCol.where({ _openid: targetOpenid }).get();
      if (res.data.length > 0) {
        const userConfig = res.data[0];
        const currentFontIndex =
          this.data.fontOptions.findIndex(
            (item) =>
              Math.abs(item.multiple - (userConfig.fontSizeMultiple || 1.0)) <
              0.01,
          ) || 0;
        this.setData({
          enableRemind: userConfig.enableRemind ?? false,
          careMode: userConfig.careMode ?? false,
          fontSizeMultiple: userConfig.fontSizeMultiple || 1.0,
          currentFontIndex,
        });
      }
    } catch (err) {
      console.error("加载目标用户配置失败：", err);
    }
  },

  async onLoad(options) {
    const app = getApp();
    if (!app.globalData) {
      app.globalData = {
        currentMode: "parent",
        openid: "",
        bindParentOpenid: "",
      };
    }
     // 核心：接收并存储推广人 leaderOpenid，完成用户与团长的绑定
    if (options.leaderOpenid) {
      // 1. 存储到全局变量（支付时直接从全局获取）
      app.globalData.leaderOpenid = options.leaderOpenid;
      // 2. 存储到本地缓存（持久化，防止小程序重启/页面刷新后丢失）
      wx.setStorageSync("leaderOpenid", options.leaderOpenid);
      console.log("✅ 成功绑定推广团长，团长openid：", options.leaderOpenid);
    } else {
      // 若没有 leaderOpenid，尝试从缓存读取（防止用户之前绑定过）
      const cacheLeaderOpenid = wx.getStorageSync("leaderOpenid");
      if (cacheLeaderOpenid) {
        app.globalData.leaderOpenid = cacheLeaderOpenid;
        console.log("✅ 从缓存读取已绑定的团长openid：", cacheLeaderOpenid);
      }
    }

    this.setData({
      isChildMode: app.globalData.currentMode === "child",
    });

    this.loadCareModeSetting();
    this.loadNoticeConfig(); // 加载通知配置
    this.loadWeather();
    await this.getVersionInfo();
    this.checkTrialExpired();
    this.loadTargetUserConfig(); // 加载同步配置

    if (!this.data.isChildMode) {
      const isSignedCache = wx.getStorageSync("isSignedToday");
      this.setData({ isSigned: isSignedCache || false });
      if (!isSignedCache) {
        await this.checkSignStatus().catch((err) =>
          console.error("检查签到状态失败：", err),
        );
      }
    }

    this.getContactsList();
    this.checkUserEmail();
    this.loadParentSignData();
  },

  async onShow() {
    const app = getApp();
    this.setData({
      isChildMode: app.globalData.currentMode === "child",
    });
    this.loadCareModeSetting();
    await this.getVersionInfo();
    this.checkTrialExpired();
    this.loadParentSignData();
    this.getContactsList();
    this.checkUserEmail();
    this.loadTargetUserConfig(); // 刷新同步配置
    this.loadNoticeConfig(); // 加载通知配置
  },
  // 新增：加载后台通知配置
  async loadNoticeConfig() {
    try {
      const res = await db.collection("noticeConfig").get();
      console.log("加载通知配置成功：", res);
      if (res.data.length > 0) {
        this.setData({ notice: res.data[0] });
      }
    } catch (err) {
      console.error("加载通知配置失败：", err);
    }
  },
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const radLat1 = (Math.PI * lat1) / 180;
    const radLat2 = (Math.PI * lat2) / 180;
    const a = radLat1 - radLat2;
    const b = (Math.PI * lon1) / 180 - (Math.PI * lon2) / 180;
    let s =
      2 *
      Math.asin(
        Math.sqrt(
          Math.pow(Math.sin(a / 2), 2) +
            Math.cos(radLat1) *
              Math.cos(radLat2) *
              Math.pow(Math.sin(b / 2), 2),
        ),
      );
    s = s * R;
    return Math.round(s * 100) / 100;
  },

  async loadWeather() {
    try {
      const DISTANCE_THRESHOLD = 20;
      const today = this.formatDate(new Date());
      const cacheInfo = wx.getStorageSync("weatherCacheInfo") || {};
      const { cacheDate, weatherData, cacheLat, cacheLon } = cacheInfo;
      console.log("cacheInfo", cacheInfo);
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

      let isCacheValid = false;
      if (cacheDate === today && weatherData && cacheLat && cacheLon) {
        const distance = this.calculateDistance(
          cacheLat,
          cacheLon,
          currentLat,
          currentLon,
        );
        isCacheValid = distance < DISTANCE_THRESHOLD;
      }
      console.log("isCacheValid", isCacheValid);
      if (isCacheValid) {
        this.setData({
          todayWeather: weatherData.todayWeather,
          tomorrowWeather: weatherData.tomorrowWeather,
          day3Weather: weatherData.day3Weather,
          activeWeatherData: weatherData.todayWeather,
          weatherList: [
            {
              date: weatherData.todayWeather.dateText,
              weather: weatherData.todayWeather.desc,
              tempMin: weatherData.todayWeather.temp.split("~")[0],
              tempMax: weatherData.todayWeather.temp
                .split("~")[1]
                .replace("℃", ""),
            },
            {
              date: weatherData.tomorrowWeather.dateText,
              weather: weatherData.tomorrowWeather.desc,
              tempMin: weatherData.tomorrowWeather.temp.split("~")[0],
              tempMax: weatherData.tomorrowWeather.temp
                .split("~")[1]
                .replace("℃", ""),
            },
            {
              date: weatherData.day3Weather.dateText,
              weather: weatherData.day3Weather.desc,
              tempMin: weatherData.day3Weather.temp.split("~")[0],
              tempMax: weatherData.day3Weather.temp
                .split("~")[1]
                .replace("℃", ""),
            },
          ],
        });
        return;
      }

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

      if (!weatherRes || !weatherRes.data) {
        wx.showToast({ title: "天气数据解析失败", icon: "none" });
        console.error("[天气模块] 响应数据为空");
        return;
      }
      if (weatherRes.statusCode !== 200) {
        wx.showToast({
          title: `天气请求失败（${weatherRes.statusCode}）`,
          icon: "none",
        });
        console.error("[天气模块] 接口状态码错误：", weatherRes.statusCode);
        return;
      }
      console.log("[天气模块] 天气数据：", weatherRes.data);
      const { code, daily } = weatherRes.data;
      switch (code) {
        case "200":
          const todayWeather = this.formatWeatherData(daily[0], "今天");
          const tomorrowWeather = this.formatWeatherData(daily[1], "明天");
          const day3Weather = this.formatWeatherData(daily[2], "后天");
          const weatherList = [
            {
              date: todayWeather.dateText,
              weather: todayWeather.desc,
              tempMin: todayWeather.temp.split("~")[0],
              tempMax: todayWeather.temp.split("~")[1].replace("℃", ""),
            },
            {
              date: tomorrowWeather.dateText,
              weather: tomorrowWeather.desc,
              tempMin: tomorrowWeather.temp.split("~")[0],
              tempMax: tomorrowWeather.temp.split("~")[1].replace("℃", ""),
            },
            {
              date: day3Weather.dateText,
              weather: day3Weather.desc,
              tempMin: day3Weather.temp.split("~")[0],
              tempMax: day3Weather.temp.split("~")[1].replace("℃", ""),
            },
          ];
          const newCacheInfo = {
            cacheDate: today,
            cacheLat: currentLat,
            cacheLon: currentLon,
            weatherData: { todayWeather, tomorrowWeather, day3Weather },
          };
          wx.setStorageSync("weatherCacheInfo", newCacheInfo);
          this.setData({
            todayWeather,
            tomorrowWeather,
            day3Weather,
            activeWeatherData: todayWeather,
            weatherList,
          });
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

  formatDate(date) {
    date = new Date(date);
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

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

  openWeatherDetail() {
    this.setData({ showWeatherDetail: true });
  },
  closeWeatherDetail() {
    this.setData({ showWeatherDetail: false });
  },

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

  loadCareModeSetting() {
    try {
      const app = getApp();
      const targetOpenid = this.data.isChildMode
        ? app.globalData.bindParentOpenid
        : app.globalData.openid;
      usersCol
        .where({ _openid: targetOpenid })
        .get()
        .then((res) => {
          if (res.data.length > 0) {
            const careMode = res.data[0].careMode || false;
            const fontSizeMultiple = res.data[0].fontSizeMultiple || 1.0;
            const validMultiple = Math.max(
              this.data.fontSizeMin,
              Math.min(this.data.fontSizeMax, fontSizeMultiple),
            );
            const currentFontIndex =
              this.data.fontOptions.findIndex(
                (item) => Math.abs(item.multiple - validMultiple) < 0.01,
              ) || 0;
            this.setData({
              careMode,
              fontSizeMultiple: validMultiple,
              currentFontIndex,
            });
          }
        });
    } catch (err) {
      console.error("读取关怀模式设置失败：", err);
    }
  },

  async getVersionInfo() {
    try {
      const app = getApp();
      const targetOpenid = this.data.isChildMode
        ? app.globalData.bindParentOpenid
        : app.globalData.openid;
      const res = await usersCol.where({ _openid: targetOpenid }).get();
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
          enableRemind: userInfo.enableRemind || false,
        });
      } else {
        const now = new Date();
        const trialEndTime = new Date(now);
        trialEndTime.setDate(trialEndTime.getDate() + 3);
        this.setData({
          serviceStartTime: this.formatDate(now),
          serviceEndTime: this.formatDate(trialEndTime),
          remainingTrialDays: 3,
          enableRemind: false,
        });
      }
    } catch (err) {
      console.error("获取版本信息失败：", err);
    }
  },

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

  // 修复：签到状态判断（未签到时强制设为 false）
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
          _openid: app.globalData.openid,
          signTime: db.command.gte(start).and(db.command.lt(end)),
        })
        .get();

      const isSigned = res.data.length > 0;
      this.setData({ isSigned }); // 未签到时 res.data 为空，isSigned 为 false
      wx.setStorageSync("isSignedToday", isSigned);
    } catch (err) {
      console.error("检查签到状态失败：", err);
      this.setData({ isSigned: false }); // 异常时强制设为未签到
    }
  },

 async handleSign() {
  if (this.data.isChildMode) {
    wx.showToast({ title: "子女模式下无法签到", icon: "none" });
    return;
  }
  if (this.data.isTrialExpired) {
    return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
  }
  if (this.data.isSigned) {
    return wx.showToast({ title: "今日已签到", icon: "none" });
  }

  try {
    const app = getApp();
    // 1. 写入签到记录（原有逻辑，无问题）
    await signCol.add({
      data: {
        _openid: app.globalData.openid,
        signTime: new Date().getTime(), // 签到时间字段，数字型时间戳
        createTime: db.serverDate(),
      },
    });
    // ========== 新增核心逻辑：重置lastRemindDays为0 ==========
    await db.collection("users").where({
      _openid: app.globalData.openid // 根据openid匹配当前用户
    }).update({
      data: {
        lastRemindDays: 0 // 签到成功，清空旧的提醒天数
      }
    });
    // ==========================================================
    this.setData({ isSigned: true });
    wx.setStorageSync("isSignedToday", true);
    wx.showToast({ title: "签到成功" });
  } catch (err) {
    console.error("签到失败：", err);
    wx.showToast({ title: "签到失败，请重试", icon: "none" });
  }
},

  async getContactsList() {
    const app = getApp();
    const targetOpenid = this.data.isChildMode
      ? app.globalData.bindParentOpenid
      : app.globalData.openid;
    try {
      const res = await contactsCol.where({ _openid: targetOpenid }).get();
      this.setData({ contactsList: res.data });
    } catch (err) {
      console.error("获取联系人失败：", err);
      if (err.errMsg.includes("permission denied")) {
        wx.showToast({ title: "无权限查看父母联系人", icon: "none" });
      } else {
        wx.showToast({ title: "加载联系人失败", icon: "none" });
      }
    }
  },

  onFormChange(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    this.setData({
      [`contactForm.${key}`]: value,
    });
  },

  showAddDialog() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }
    this.setData({ showAddDialog: true });
  },

  onCancelAddContact() {
    this.setData({
      showAddDialog: false,
      contactForm: { name: "", phone: "" },
    });
  },

  async onConfirmAddContact() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const app = getApp();
      const { name, phone } = this.data.contactForm;
      const targetOpenid = this.data.isChildMode
        ? app.globalData.bindParentOpenid
        : app.globalData.openid;

      const hasPermission = await this.checkChildPermission(targetOpenid);
      if (!hasPermission) return;

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
          _openid: targetOpenid,
          createTime: db.serverDate(),
        },
      });

      wx.showToast({ title: "联系人添加成功" });
      this.onCancelAddContact();
      this.getContactsList();
    } catch (err) {
      console.error("添加联系人失败：", err);
      if (err.errMsg.includes("permission denied")) {
        wx.showToast({ title: "无权限添加父母联系人", icon: "none" });
      } else {
        wx.showToast({ title: "添加失败，请重试", icon: "none" });
      }
    }
  },

  async deleteContact(e) {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const id = e.currentTarget.dataset.id;
      const contactRes = await contactsCol.doc(id).get();
      const targetOpenid = contactRes.data._openid;

      const hasPermission = await this.checkChildPermission(targetOpenid);
      if (!hasPermission) return;

      await contactsCol.doc(id).remove();
      wx.showToast({ title: "联系人删除成功" });
      this.getContactsList();
    } catch (err) {
      console.error("删除联系人失败：", err);
      if (err.errMsg.includes("permission denied")) {
        wx.showToast({ title: "无权限删除父母联系人", icon: "none" });
      } else {
        wx.showToast({ title: "删除失败，请重试", icon: "none" });
      }
    }
  },

  async checkUserEmail() {
    const app = getApp();
    const targetOpenid = this.data.isChildMode
      ? app.globalData.bindParentOpenid
      : app.globalData.openid;

    try {
      const res = await emailsCol.where({ _openid: targetOpenid }).get();
      this.setData({ emailList: res.data });
    } catch (err) {
      console.error("获取邮箱失败：", err);
      if (err.errMsg.includes("permission denied")) {
        wx.showToast({ title: "无权限查看父母邮箱", icon: "none" });
      } else {
        wx.showToast({ title: "加载邮箱列表失败", icon: "none" });
      }
    }
  },

  emailChange(e) {
    this.setData({ email: e.detail.value });
  },

  showEmailDialog() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }
    this.setData({ showEmailDialog: true });
  },

  cancelBindEmail() {
    this.setData({ showEmailDialog: false, email: "" });
  },

  async bindEmail() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const app = getApp();
      const { email } = this.data;
      const targetOpenid = this.data.isChildMode
        ? app.globalData.bindParentOpenid
        : app.globalData.openid;

      const hasPermission = await this.checkChildPermission(targetOpenid);
      if (!hasPermission) return;

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
          _openid: targetOpenid,
          createTime: db.serverDate(),
        },
      });

      wx.showToast({ title: "邮箱添加成功" });
      this.cancelBindEmail();
      this.checkUserEmail();
    } catch (err) {
      console.error("添加邮箱失败：", err);
      if (err.errMsg.includes("permission denied")) {
        wx.showToast({ title: "无权限添加父母邮箱", icon: "none" });
      } else {
        wx.showToast({ title: "添加失败，请重试", icon: "none" });
      }
    }
  },

  async deleteEmail(e) {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const id = e.currentTarget.dataset.id;
      const emailRes = await emailsCol.doc(id).get();
      const targetOpenid = emailRes.data._openid;

      const hasPermission = await this.checkChildPermission(targetOpenid);
      if (!hasPermission) return;

      await emailsCol.doc(id).remove();
      wx.showToast({ title: "邮箱删除成功" });
      this.checkUserEmail();
    } catch (err) {
      console.error("删除邮箱失败：", err);
      if (err.errMsg.includes("permission denied")) {
        wx.showToast({ title: "无权限删除父母邮箱", icon: "none" });
      } else {
        wx.showToast({ title: "删除失败，请重试", icon: "none" });
      }
    }
  },

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

  onUserNameInput(e) {
    this.setData({ userName: e.detail.value });
  },

  async saveUserName() {
    if (this.data.isTrialExpired) {
      return wx.showToast({ title: "试用已到期，请升级正式版", icon: "none" });
    }

    try {
      const app = getApp();
      const { userName } = this.data;
      const targetOpenid = this.data.isChildMode
        ? app.globalData.bindParentOpenid
        : app.globalData.openid;

      const hasPermission = await this.checkChildPermission(targetOpenid);
      if (!hasPermission) return;

      if (!userName.trim()) {
        return wx.showToast({ title: "请输入姓名", icon: "none" });
      }

      const res = await usersCol.where({ _openid: targetOpenid }).get();
      if (res.data.length > 0) {
        await usersCol
          .doc(res.data[0]._id)
          .update({ data: { name: userName.trim() } });
      } else {
        await usersCol.add({
          data: {
            name: userName.trim(),
            createTime: db.serverDate(),
            _openid: targetOpenid,
          },
        });
      }

      wx.showToast({ title: "姓名保存成功" });
    } catch (err) {
      console.error("保存备注失败：", err);
      if (err.errMsg.includes("permission denied")) {
        wx.showToast({ title: "无权限修改父母姓名", icon: "none" });
      } else {
        wx.showToast({ title: "保存失败，请重试", icon: "none" });
      }
    }
  },

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
          const targetOpenid = this.data.isChildMode
            ? app.globalData.bindParentOpenid
            : app.globalData.openid;

          const hasPermission = await this.checkChildPermission(targetOpenid);
          if (!hasPermission) return;

          const userRes = await usersCol.where({ _openid: targetOpenid }).get();
          if (userRes.data.length > 0) {
            await usersCol
              .doc(userRes.data[0]._id)
              .update({ data: { homeLocation } });
          } else {
            await usersCol.add({
              data: {
                homeLocation,
                createTime: db.serverDate(),
                _openid: targetOpenid,
              },
            });
          }

          this.setData({ homeLocation });
          wx.showToast({ title: "家庭位置设置成功" });
        } catch (err) {
          console.error("保存位置失败：", err);
          if (err.errMsg.includes("permission denied")) {
            wx.showToast({ title: "无权限设置父母家庭位置", icon: "none" });
          } else {
            wx.showToast({ title: "设置失败，请重试", icon: "none" });
          }
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

  showPayDialog() {
    this.setData({ showPayDialog: true });
  },

  closePayDialog() {
    this.setData({ showPayDialog: false });
  },

  async choosePayType(e) {
    const type = e.currentTarget.dataset.type;
    const amount = type === "month" ? 3 : 20;
    const app = getApp();

    const targetOpenid = this.data.isChildMode
      ? app.globalData.bindParentOpenid
      : app.globalData.openid;
    try {
      wx.showLoading({ title: "创建订单中..." });
      const res = await wx.cloud.callFunction({
        name: "createPayOrder",
        data: {
          openid: targetOpenid,
          payType: type,
          amount,
          payerOpenid: app.globalData.openid,
        },
      });
      wx.hideLoading();

      if (res.result?.success) {
        const payParams = res.result.payParams;
        wx.requestPayment({
          ...payParams,
          success: async () => {
            await this.updateUserVersion(type, targetOpenid);
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

  async updateUserVersion(payType, targetOpenid) {
    try {
      const app = getApp();
      const now = new Date();
      const userRes = await usersCol.where({ _openid: targetOpenid }).get();

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
        payerOpenid: app.globalData.openid,
      };

      if (userRes.data.length > 0) {
        await usersCol.doc(userRes.data[0]._id).update({ data: updateData });
      } else {
        await usersCol.add({
          data: {
            _openid: targetOpenid,
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

  showModeSwitchSheet() {
    this.setData({ showModeSheet: true });
  },

  cancelModeSwitch() {
    this.setData({
      showModeSheet: false,
      bindCode: "",
      focusBindCode: false,
    });
  },

  onBindCodeInput(e) {
    this.setData({ bindCode: e.detail.value });
  },

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

  confirmModeSwitch() {
    const { isChildMode, bindCode } = this.data;
    const app = getApp();

    this.setData({ showModeSheet: false });

    if (!isChildMode) {
      if (!bindCode || bindCode.length !== 6) {
        wx.showToast({ title: "请输入6位父母绑定码", icon: "none" });
        return;
      }

      wx.showLoading({ title: "验证中..." });

      wx.cloud.callFunction({
        name: "checkBindCode",
        data: { bindCode },
        success: async (res) => {
          wx.hideLoading();
          const result = res.result;
          if (result.success) {
            app.globalData.currentMode = "child";
            app.globalData.bindParentOpenid = result.parentOpenid;
            app.globalData.bindParentInfo = result.parentInfo;
            // 写入缓存（关键：持久化子女模式）
            wx.setStorageSync("currentMode", "child");
            wx.setStorageSync("bindParentOpenid", result.parentOpenid);
            wx.setStorageSync("bindParentInfo", result.parentInfo);

            this.setData({
              isChildMode: true,
              bindParentInfo: result.parentInfo,
            });

            try {
              await bindRelationsCol.doc(app.globalData.openid).set({
                data: {
                  parentOpenid: result.parentOpenid,
                  bindCode: bindCode,
                  createTime: db.serverDate(),
                  updateTime: db.serverDate(),
                },
              });
            } catch (bindErr) {
              console.error("绑定关系写入失败：", bindErr);
            }

            this.getVersionInfo();
            this.getContactsList();
            this.checkUserEmail();
            this.loadParentSignData();
            this.loadTargetUserConfig();
            wx.showToast({ title: "已切换至子女模式", icon: "success" });
          } else {
            wx.showToast({ title: result.errMsg, icon: "none" });
          }
        },
        fail: (err) => {
          wx.hideLoading();
          console.error("调用云函数失败：", err);
          wx.showToast({ title: "切换失败，请重试", icon: "none" });
        },
      });
    } else {
      app.globalData.currentMode = "parent";
      app.globalData.bindParentOpenid = "";
      app.globalData.bindParentInfo = null;
      // 清空缓存（关键：持久化父母模式）
      wx.setStorageSync("currentMode", "parent");
      wx.setStorageSync("bindParentOpenid", "");
      wx.setStorageSync("bindParentInfo", {});

      this.setData({ isChildMode: false });
      this.getVersionInfo();
      this.getContactsList();
      this.checkUserEmail();
      this.checkSignStatus();
      this.loadTargetUserConfig();
      wx.showToast({ title: "已切换至父母模式", icon: "success" });
    }
  },

  loadParentSignData() {
    const { isChildMode } = this.data;
    const app = getApp();
    if (!isChildMode || !app.globalData.bindParentOpenid) {
      return;
    }

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

    signCol
      .where({
        _openid: app.globalData.bindParentOpenid,
        signTime: db.command.gte(start).and(db.command.lt(end)),
      })
      .get()
      .then((res) => {
        this.setData({ parentSignStatus: res.data.length > 0 });

        const last7Days = [];
        for (let i = 6; i >= 0; i--) {
          const date = new Date();
          date.setDate(today.getDate() - i);
          last7Days.push(this.formatDate(date));
        }

        const historyPromises = last7Days.map((dateStr) => {
          const [year, month, day] = dateStr.split("-").map(Number);
          const dayStart = new Date(year, month - 1, day).getTime();
          const dayEnd = new Date(year, month - 1, day + 1).getTime();
          return signCol
            .where({
              _openid: app.globalData.bindParentOpenid,
              signTime: db.command.gte(dayStart).and(db.command.lt(dayEnd)),
            })
            .get();
        });

        Promise.all(historyPromises).then((results) => {
          const parentSignHistory = last7Days.map((date, index) => ({
            date,
            isSigned: results[index].data.length > 0,
          }));
          this.setData({ parentSignHistory });
        });
      })
      .catch((err) => {
        console.error("加载父母签到数据失败：", err);
      });
  },
});
