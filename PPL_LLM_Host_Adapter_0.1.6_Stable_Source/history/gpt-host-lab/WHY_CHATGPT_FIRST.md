# 为什么先用当前 ChatGPT 作为真实 Host 推理端

优点：

- 调试周期短；
- 可以直接观察 Profile policy 对高能力模型行为的实际约束；
- 可以在同一对话中检查越权、幻觉、过早结论与教学策略漂移；
- 不需要先为某个供应商 SDK 绑定 Profiles。

限制：

- 当前 transport 不是自动 API；
- 同一模型参与生成与设计，不能代替独立 human evaluation；
- 不能据此声明模型质量、教学效果或科研准确率已经得到统计验证。

因此它是 **behavioral integration gate**，不是最终生产 Host benchmark。
