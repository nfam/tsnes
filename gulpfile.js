var del = require('del');
var gulp = require('gulp');
var addsrc = require('gulp-add-src');
var change = require('gulp-change');
var concat = require('gulp-concat');
var replace = require('gulp-replace');
var strip = require('gulp-strip-comments');
var ts = require('gulp-typescript');
var uglify = require('gulp-uglify');

// build
{
    gulp.task('nes', function() {
        return gulp.src('src/components/*.ts')
        .pipe(strip())
        .pipe(change((content) => {
            return content.split('\n').map((line) => {
                if (line.startsWith('export default')) {
                    return line.substring('export default'.length);
                }
                else if (line.startsWith('export')) {
                    return line.substring('export'.length);
                }
                else if (line.startsWith('import')) {
                    return '';
                }
                else {
                    return line;
                }
            }).join('\n');
        }))
        .pipe(addsrc('src/speaker.ts'))
        .pipe(concat('nes.ts'))
        .pipe(change((content) => {
            return content.split('\n').map((line) => {
                if (line.startsWith('import')) {
                    return '';
                } else {
                    return line;
                }
            }).join('\n');
        }))
        .pipe(ts({
            "target": "es5",
            "module": "umd",
            "declaration": true,
            "noImplicitAny": true
        }))
        .pipe(gulp.dest('dist'));
    });
    gulp.task('nes.min', ['nes'], function() {
        return gulp.src('dist/nes.js')
        .pipe(uglify({
            "preserveComments": "license"
        }))
        .pipe(concat('nes.min.js'))
        .pipe(gulp.dest('dist'));
    });
    gulp.task('default', ['nes.min']);
}

// clean
{
    gulp.task('clean', ['clean-build']);
    gulp.task('clean-build', function(done) {
        del('.build').then(function() {
            done();
        });
    });
    gulp.task('clean-dist', function(done) {
        del('dist').then(function() {
            done();
        });
    });
}
