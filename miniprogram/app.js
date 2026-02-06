// app.js 完整正确代码（新增团长推广全局适配）
App({
  globalData: {
    env: "cloud1-1g3o4tw9e7ccdcb7",
    openid: "",
    // 子女模式全局状态
    currentMode: "parent",
    bindParentOpenid: "",
    bindParentInfo: {},
    // 🌟 新增：团长推广相关全局状态（适配团长中心/订单绑定）
    leaderOpenid: "", // 推广人openid（自己推广则等于openid，被推广则存推广人id）
    isLeader: false, // 是否为团长（标记状态，简化页面判断）
  },

  onLaunch: function () {
    // ⭐ 新增：读取本地缓存恢复模式状态（持久化核心）
    const cachedMode = wx.getStorageSync("currentMode") || "parent";
    const cachedParentOpenid = wx.getStorageSync("bindParentOpenid") || "";
    const cachedParentInfo = wx.getStorageSync("bindParentInfo") || {};
    // 🌟 新增：读取团长相关缓存，持久化推广状态
    const cachedLeaderOpenid = wx.getStorageSync("leaderOpenid") || "";
    const cachedIsLeader = wx.getStorageSync("isLeader") || false;

    // ⭐ 原有：缓存数据同步到全局，确保状态一致
    this.globalData.currentMode = cachedMode;
    this.globalData.bindParentOpenid = cachedParentOpenid;
    this.globalData.bindParentInfo = cachedParentInfo;
    // 🌟 新增：团长缓存同步到全局
    this.globalData.leaderOpenid = cachedLeaderOpenid;
    this.globalData.isLeader = cachedIsLeader;

    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      wx.showToast({ title: "基础库版本过低，不支持云开发", icon: "none" });
      return;
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }

    // 恢复模式状态
    this.restoreModeState();
    // 🌟 新增：恢复团长推广状态
    this.restoreLeaderState();
    // 获取openid
    this.getOpenid();
  },

  // 获取openid（原有正确逻辑，无修改）
  async getOpenid() {
    try {
      const res = await wx.cloud.callFunction({
        name: "quickstartFunctions",
        data: {
          type: "getOpenId",
        },
      });
      this.globalData.openid = res.result.openid;
      console.log("✅ OpenID获取成功：", this.globalData.openid);
      // 🌟 新增：若未设置推广人，默认自己为推广人（自己推广自己计数）
      if (!this.globalData.leaderOpenid) {
        this.setLeaderInfo({
          leaderOpenid: this.globalData.openid,
          isLeader: true,
        });
      }
    } catch (err) {
      console.error("❌ OpenID获取失败：", err);
      wx.showToast({ title: "OpenID获取失败", icon: "none" });
    }
  },

  // 恢复本地缓存的亲子模式状态（原有逻辑，无修改）
  restoreModeState() {
    try {
      const currentMode = wx.getStorageSync("currentMode") || "parent";
      const bindParentOpenid = wx.getStorageSync("bindParentOpenid") || "";
      const bindParentInfo = wx.getStorageSync("bindParentInfo") || {};

      this.globalData.currentMode = currentMode;
      this.globalData.bindParentOpenid = bindParentOpenid;
      this.globalData.bindParentInfo = bindParentInfo;

      console.log("✅ 亲子模式状态恢复成功：", {
        currentMode,
        bindParentOpenid: bindParentOpenid ? "已绑定" : "未绑定",
        bindParentName: bindParentInfo.name || "无",
      });
    } catch (err) {
      console.error("❌ 亲子模式状态恢复失败：", err);
    }
  },

  // 保存亲子模式状态到本地缓存（原有逻辑，无修改）
  saveModeState(modeInfo) {
    try {
      const { currentMode, bindParentOpenid, bindParentInfo } = modeInfo;
      this.globalData.currentMode = currentMode;
      this.globalData.bindParentOpenid = bindParentOpenid;
      this.globalData.bindParentInfo = bindParentInfo;

      wx.setStorageSync("currentMode", currentMode);
      wx.setStorageSync("bindParentOpenid", bindParentOpenid);
      wx.setStorageSync("bindParentInfo", bindParentInfo);

      console.log("✅ 亲子模式状态保存成功：", currentMode);
    } catch (err) {
      console.error("❌ 亲子模式状态保存失败：", err);
      wx.showToast({ title: "模式状态保存失败", icon: "none" });
    }
  },

  // 🌟 新增：恢复团长推广状态（从本地缓存读取，持久化）
  restoreLeaderState() {
    try {
      const leaderOpenid = wx.getStorageSync("leaderOpenid") || "";
      const isLeader = wx.getStorageSync("isLeader") || false;

      this.globalData.leaderOpenid = leaderOpenid;
      this.globalData.isLeader = isLeader;

      console.log("✅ 团长推广状态恢复成功：", {
        isLeader: isLeader ? "是团长" : "非团长",
        leaderOpenid: leaderOpenid || "未设置推广人",
      });
    } catch (err) {
      console.error("❌ 团长推广状态恢复失败：", err);
    }
  },

  // 🌟 新增：保存团长推广状态（同步到全局+本地缓存，核心方法）
  setLeaderInfo(leaderInfo) {
    try {
      const { leaderOpenid, isLeader = true } = leaderInfo;
      // 同步到全局数据
      this.globalData.leaderOpenid = leaderOpenid;
      this.globalData.isLeader = isLeader;
      // 持久化到本地缓存，重启小程序不丢失
      wx.setStorageSync("leaderOpenid", leaderOpenid);
      wx.setStorageSync("isLeader", isLeader);

      console.log("✅ 团长推广状态设置成功：", {
        isLeader,
        leaderOpenid,
      });
    } catch (err) {
      console.error("❌ 团长推广状态设置失败：", err);
      wx.showToast({ title: "推广状态设置失败", icon: "none" });
    }
  },
});
