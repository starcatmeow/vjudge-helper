# Change Log

## [0.2.3]

Update @starcatmeow/vjudge-api to v0.5.0, fix https://github.com/starcatmeow/vjudge-helper/issues/2.

## [0.2.2]

Manually store cookies to avoid unexpected errors.

## [0.2.1]

Change the request method from puppeteer to actual HTTP API to provide better compatibility and performance.

Features:
- Check login status & auto relogin before requesting, to avoid session expiration.
- Display additional info (e.g. compiler log) of submission.

将请求方式从之前的Puppeteer模拟操作更换为HTTP API，带来更好的兼容性及性能

新功能：
- 在发起请求前检查登录状态，避免因会话过期造成的问题
- 可以查看提交的附加信息（如编译日志）

## [0.1.0]

Complete basic features - view contests, problems in contests, and submit code.

完成基本功能（查看比赛、比赛题目、提交代码）
