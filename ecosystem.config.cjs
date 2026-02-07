module.exports = {
    apps: [
        {
            name: 'botai',
            cwd: '/var/www/botai',
            script: 'dist/index.js',
            instances: 1,
            exec_mode: 'fork',
            env: {
                NODE_ENV: 'production',
                PORT: 3001,
            },
            error_file: '/var/www/botai/logs/error.log',
            out_file: '/var/www/botai/logs/out.log',
            log_file: '/var/www/botai/logs/combined.log',
            time: true,
        },
    ],
};
