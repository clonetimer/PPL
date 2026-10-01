# PPL Platform Gateway

单进程暴露五个相互隔离的产品 vertical：

- `/v1/agent/*`
- `/v1/research/*`
- `/v1/tutor/*`
- `/v1/life/*`
- `/v1/character/*`

`GET /v1/apps` 返回可用 vertical 及其治理边界。Gateway 统一部署，不合并业务 schema。
