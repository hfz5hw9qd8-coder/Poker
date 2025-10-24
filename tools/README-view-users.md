# view_users utility

This small utility tries to list users from MongoDB (if `MONGO_URI` is set) or from the backend dev endpoint `http://localhost:5000/api/dev/users`.

How to build the Windows executable (on your Windows machine):

1. Install dependencies and `pkg`:

```powershell
cd C:\Users\mathieu\Desktop\poker
npm install
```

2. Build the exe using `pkg` (included as a devDependency):

```powershell
npm run build:view-users
```

This will produce `dist\view_users.exe` (name depends on pkg target).

How to run the exe:

```powershell
# If you want to target MongoDB, set MONGO_URI environment variable
$env:MONGO_URI = 'mongodb://localhost:27017/poker'
# or point to backend dev endpoint
$env:BACKEND_URL = 'http://localhost:5000/api/dev/users'
.\dist\view_users.exe
```

Notes:
- The executable will try MongoDB first; if it cannot connect it will call the backend endpoint.
- If you don't have Docker/Mongo running, ensure the backend is running on port 5000 (the dev endpoints work in memory).
- On first run `npm install` will install `pkg`; building the exe requires `pkg` native binaries (no admin rights normally).
