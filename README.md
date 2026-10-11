# 我们的清单小程序

这是一个基于微信云开发的两人清单小程序 MVP。

## 已配置

- 小程序云环境：`cloud1-d1g0664ch79be5fa9`
- 前端页面：初始化数据库、绑定空间、想做清单、事项详情、照片墙、我的
- 云函数：初始化集合、登录、创建空间、加入空间、创建事项、查询事项、事项详情、完成状态、上传照片、照片墙

## 自动创建集合

已新增 `initDatabase` 云函数和 `pages/init/index` 初始化页面。

使用方式：

1. 在微信开发者工具左侧 `cloudfunctions/initDatabase` 上右键。
2. 选择“上传并部署：云端安装依赖”。
3. 编译小程序，首页会先进入“初始化数据库”。
4. 点击“创建数据库集合”。
5. 看到 `created` 或 `exists` 后，点击“进入小程序”。

会自动创建以下集合：

- `users`
- `couples`
- `todos`
- `todo_photos`

## 需要上传的云函数

先在微信开发者工具中切换到小程序实际使用的云环境 `cloud1-d1g0664ch79be5fa9`，再在左侧 `cloudfunctions` 下逐个右键这些目录，选择“上传并部署：云端安装依赖”：

- `initDatabase`
- `login`
- `createCouple`
- `joinCouple`
- `createTodo`
- `getTodos`
- `getTodoDetail`
- `toggleTodoStatus`
- `uploadTodoPhoto`
- `uploadAlbumPhoto`
- `getPhotoWall`
- `updateTodo`
- `deleteTodoPhoto`

`uploadTodoPhoto` 和 `uploadAlbumPhoto` 都需要在各自目录的 `config.json` 中声明 `security.imgSecCheck` 权限。修改权限配置后需要重新上传对应云函数；微信侧权限缓存可能需要约 10 分钟才生效。

这两个上传云函数还需要在云开发控制台的云函数详情页 → 高级设置中，把超时时间从默认的 3 秒调到 20 秒。图片审核包含文件下载和微信接口调用，3 秒通常不足；`config.json` 不能替代控制台的运行超时设置。

## 测试流程

1. 先上传 `initDatabase` 云函数。
2. 编译后点击“创建数据库集合”。
3. 上传剩余云函数。
4. 点击“进入小程序”。
5. 创建两人空间，复制邀请码。
6. 用另一个微信号输入邀请码加入。
7. 添加事项、标记完成、在事项详情上传照片。
