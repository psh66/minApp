// app.js 完整正确代码
App({
  globalData: {
    env: "cloud1-1g3o4tw9e7ccdcb7",
    openid: "",
    // 子女模式全局状态
    currentMode: "parent",       
    bindParentOpenid: "",        
    bindParentInfo: {}           
  },

  onLaunch: function () {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      wx.showToast({ title: '基础库版本过低，不支持云开发', icon: 'none' });
      return;
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
    }

    // 恢复模式状态
    this.restoreModeState();
    // 获取openid
    this.getOpenid();
  },

  // 获取openid（原有正确逻辑）
  async getOpenid() {
    try {
      const res = await wx.cloud.callFunction({ 
        name: 'quickstartFunctions',
        data: {
          type: "getOpenId"
        }
      });
      this.globalData.openid = res.result.openid;
      console.log("✅ OpenID获取成功：", this.globalData.openid);
    } catch (err) {
      console.error("❌ OpenID获取失败：", err);
      wx.showToast({ title: 'OpenID获取失败', icon: 'none' });
    }
  },

  // 恢复本地缓存的模式状态
  restoreModeState() {
    try {
      const currentMode = wx.getStorageSync("currentMode") || "parent";
      const bindParentOpenid = wx.getStorageSync("bindParentOpenid") || "";
      const bindParentInfo = wx.getStorageSync("bindParentInfo") || {};

      this.globalData.currentMode = currentMode;
      this.globalData.bindParentOpenid = bindParentOpenid;
      this.globalData.bindParentInfo = bindParentInfo;

      console.log("✅ 模式状态恢复成功：", {
        currentMode,
        bindParentOpenid: bindParentOpenid ? "已绑定" : "未绑定",
        bindParentName: bindParentInfo.name || "无"
      });
    } catch (err) {
      console.error("❌ 模式状态恢复失败：", err);
    }
  },

  // 保存模式状态到本地缓存
  saveModeState(modeInfo) {
    try {
      const { currentMode, bindParentOpenid, bindParentInfo } = modeInfo;
      this.globalData.currentMode = currentMode;
      this.globalData.bindParentOpenid = bindParentOpenid;
      this.globalData.bindParentInfo = bindParentInfo;

      wx.setStorageSync("currentMode", currentMode);
      wx.setStorageSync("bindParentOpenid", bindParentOpenid);
      wx.setStorageSync("bindParentInfo", bindParentInfo);

      console.log("✅ 模式状态保存成功：", currentMode);
    } catch (err) {
      console.error("❌ 模式状态保存失败：", err);
      wx.showToast({ title: "模式状态保存失败", icon: "none" });
    }
  }
});