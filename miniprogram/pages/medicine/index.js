const db = wx.cloud.database();

Page({
  data: {
    isChildMode: false,
    targetOpenid: "",
    medicineList: [],
    showMedicineDialog: false,
    editMedicineItem: null,
    medicineForm: {
      medicineName: "",
      dose: "",
      takeTimeDesc: "",
      remindTime: [],
      repeatDays: [],
    },
    weekOptions: [
      { label: "周一", value: "周一", selected: false },
      { label: "周二", value: "周二", selected: false },
      { label: "周三", value: "周三", selected: false },
      { label: "周四", value: "周四", selected: false },
      { label: "周五", value: "周五", selected: false },
      { label: "周六", value: "周六", selected: false },
      { label: "周日", value: "周日", selected: false },
    ],
    fontSizeMultiple: 1.0,
    currentTime: "07:00", // 时间选择器默认值
  },

  onLoad(options) {
    this.setData({
      isChildMode: options.isChildMode === "true",
      targetOpenid: options.targetOpenid,
    });
    this.loadMedicineList();
    this.loadFontSize();
  },

  // 加载字体大小设置
  loadFontSize() {
    db.collection("users")
      .where({ _openid: this.data.targetOpenid })
      .get()
      .then((res) => {
        if (res.data.length > 0) {
          this.setData({
            fontSizeMultiple: res.data[0].fontSizeMultiple || 1.0,
          });
        }
      });
  },

  // 加载用药提醒列表（兼容字段名+数组校验）
  // 加载用药提醒列表（兼容字段名+数组校验+类型转换）
  async loadMedicineList() {
    try {
      const res = await db
        .collection("medicineRemind")
        .where({
          parentOpenid: this.data.targetOpenid,
          isEnable: true,
        })
        .get();

      const list = res.data.map((item) => {
        let remindTime = item.remindTime || item.remind_time || [];
        if (typeof remindTime === "string") {
          remindTime = remindTime.split(",").map((t) => t.trim());
        } else if (!Array.isArray(remindTime)) {
          remindTime = [];
        }

        let repeatDays = item.repeatDays || item.repeat_days || [];
        if (typeof repeatDays === "string") {
          repeatDays = repeatDays.split(",").map((d) => d.trim());
        } else if (!Array.isArray(repeatDays)) {
          repeatDays = [];
        }

        return {
          ...item,
          remindTime,
          repeatDays,
        };
      });

      console.log("加载的用药提醒列表：", list);

      // 关键修复：先清空，再赋值，强制刷新
      this.setData({ medicineList: [] }, () => {
        this.setData({ medicineList: list });
      });
    } catch (err) {
      console.error("加载用药提醒列表失败：", err);
      wx.showToast({ title: "加载失败，请重试", icon: "none" });
    }
  },

  // 显示添加弹窗（默认未选中任何星期）
  showAddMedicineDialog() {
    this.setData({
      showMedicineDialog: true,
      editMedicineItem: null,
      medicineForm: {
        medicineName: "",
        dose: "",
        takeTimeDesc: "",
        remindTime: [],
        repeatDays: [],
      },
      currentTime: "07:00",
      weekOptions: this.data.weekOptions.map((item) => ({
        ...item,
        selected: false,
      })),
    });
  },

  // 编辑用药提醒（完整回显逻辑）
  editMedicine(e) {
    const item = e.currentTarget.dataset.item;
    // 数组合法性校验
    const remindTime =
      item.remindTime && Array.isArray(item.remindTime) ? item.remindTime : [];
    const repeatDays =
      item.repeatDays && Array.isArray(item.repeatDays) ? item.repeatDays : [];
    const defaultTime = remindTime.length > 0 ? remindTime[0] : "07:00";

    this.setData({
      showMedicineDialog: true,
      editMedicineItem: item,
      medicineForm: {
        medicineName: item.medicineName,
        dose: item.dose,
        takeTimeDesc: item.takeTimeDesc || "",
        remindTime: remindTime,
        repeatDays: repeatDays,
      },
      currentTime: defaultTime,
      // 同步星期选中状态
      weekOptions: this.data.weekOptions.map((weekItem) => ({
        ...weekItem,
        selected: repeatDays.includes(weekItem.value),
      })),
    });
  },

  // 取消弹窗
  cancelMedicineDialog() {
    this.setData({
      showMedicineDialog: false,
    });
  },

  // 表单输入
  onMedicineFormChange(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({
      [`medicineForm.${key}`]: e.detail.value,
    });
  },

  // 时间选择器确认选择
  confirmTimeSelect(e) {
    const selectedTime = e.detail.value;
    this.setData({
      currentTime: selectedTime,
    });
  },

  // 取消时间选择器（空方法，兼容绑定）
  cancelTimeSelect() {},

  // 添加选中的时间到提醒列表
  addRemindTime() {
    const { remindTime } = this.data.medicineForm;
    const { currentTime } = this.data;

    // 判空：避免添加空时间
    if (!currentTime) {
      return wx.showToast({ title: "请先选择有效时间", icon: "none" });
    }

    // 避免重复添加
    if (remindTime.includes(currentTime)) {
      return wx.showToast({ title: "该时间已添加", icon: "none" });
    }

    this.setData({
      "medicineForm.remindTime": [...remindTime, currentTime],
    });
    wx.showToast({ title: "添加成功", icon: "success" });
  },

  // 移除已选的提醒时间
  removeRemindTime(e) {
    const index = e.currentTarget.dataset.index;
    const remindTime = [...this.data.medicineForm.remindTime];
    remindTime.splice(index, 1);

    this.setData({
      "medicineForm.remindTime": remindTime,
    });
  },

  // 切换星期选择（样式实时更新）
  toggleWeekOption(e) {
    const value = e.currentTarget.dataset.value;
    const weekOptions = this.data.weekOptions.map((item) => {
      if (item.value === value) {
        return { ...item, selected: !item.selected };
      }
      return item;
    });
    // 同步repeatDays数组
    const repeatDays = weekOptions
      .filter((item) => item.selected)
      .map((item) => item.value);

    this.setData({
      weekOptions,
      "medicineForm.repeatDays": repeatDays,
    });
    console.log("当前选中的星期：", repeatDays);
  },

  // 保存用药提醒（强校验+数组兼容）
  async saveMedicineRemind() {
    const { medicineName, dose, remindTime, repeatDays } =
      this.data.medicineForm;

    // 校验必填项
    if (!medicineName.trim()) {
      return wx.showToast({ title: "请输入药品名称", icon: "none" });
    }
    if (!dose.trim()) {
      return wx.showToast({ title: "请输入服用剂量", icon: "none" });
    }
    if (remindTime.length === 0) {
      return wx.showToast({ title: "请选择至少一个提醒时间", icon: "none" });
    }
    if (repeatDays.length === 0) {
      return wx.showToast({ title: "请选择至少一个重复日期", icon: "none" });
    }

    try {
      const app = getApp();
      const formData = {
        ...this.data.medicineForm,
        parentOpenid: this.data.targetOpenid,
        childOpenid: app.globalData.openid,
        isEnable: true,
        updateTime: db.serverDate(),
        // 强制确保数组格式
        remindTime: Array.isArray(remindTime) ? remindTime : [],
        repeatDays: Array.isArray(repeatDays) ? repeatDays : [],
      };

      if (this.data.editMedicineItem) {
        // 编辑
        await db
          .collection("medicineRemind")
          .doc(this.data.editMedicineItem._id)
          .update({ data: formData });
      } else {
        // 新增
        formData.createTime = db.serverDate();
        await db.collection("medicineRemind").add({ data: formData });
      }

      wx.showToast({
        title: this.data.editMedicineItem ? "修改成功" : "添加成功",
      });
      this.setData({ showMedicineDialog: false });
      this.loadMedicineList();
    } catch (err) {
      console.error("保存用药提醒失败：", err);
      wx.showToast({ title: "操作失败，请重试", icon: "none" });
    }
  },

  // 删除用药提醒（软删除）
  async deleteMedicine(e) {
    const id = e.currentTarget.dataset.id;

    wx.showModal({
      title: "确认删除",
      content: "删除后将无法恢复，是否确认？",
      success: async (res) => {
        if (res.confirm) {
          try {
            await db
              .collection("medicineRemind")
              .doc(id)
              .update({
                data: { isEnable: false }, // 软删除
              });
            wx.showToast({ title: "删除成功" });
            this.loadMedicineList();
          } catch (err) {
            console.error("删除用药提醒失败：", err);
            wx.showToast({ title: "删除失败，请重试", icon: "none" });
          }
        }
      },
    });
  },
});
