App({
  globalData: {
    env: "cloud1-1g3o4tw9e7ccdcb7",
    openid: ""
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
    this.getOpenid();
  },

  // 关键修改：去掉type参数，直接调用
  async getOpenid() {
    try {
      // 1. 函数名必须是quickstartFunctions
      // 2. 必须传type: "getOpenId"
      const res = await wx.cloud.callFunction({ 
        name: 'quickstartFunctions',
        data: {
          type: "getOpenId"
        }
      });
      this.globalData.openid = res.result.openid;
      console.log("✅ OpenID获取成功：", this.globalData.openid);
      // wx.showToast({ title: 'OpenID获取成功', icon: 'success' });
    } catch (err) {
      console.error("❌ OpenID获取失败：", err);
      wx.showToast({ title: 'OpenID获取失败', icon: 'none' });
    }
  },
});