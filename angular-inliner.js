#!/bin/node

//imports
const path = require('path'),
      fs = require("fs")
      cleancss = new (require('clean-css'))({returnPromise: true});
      html_minify = require('html-minifier').minify
      sass = require('node-sass');

//global variable initialization
var verbose = false;
var dist_dir = path.resolve('./dist/src');
var src_dir = path.resolve('./lib/');
for(var i = 0; i < process.argv.length; i++)
{
    var split = process.argv[i].split('=');
    switch(split[0])
    {
        case '-v':
        case '-V':
            verbose = true;
            break;
        case 'dist':
            dist_dir = path.resolve(split[1]);
            break;
        case 'src':
            src_dir = path.resolve(split[1]);
            break;
        case '-h':
        case '--help':
            console.log("this command will find all the component files under the \"dist\" directory and replace angular resource urls with minified inline " +
                "interpretations. All file urls found will be resolve with relative paths starting from the \"src\" directory. works with html scss and css files\n\nflags:\n" +
                "       -v                     verbose output will print at almost every function entry\n\n" +
                "       dist=[directory path]  this will set the dist directory to the given string.\n                              default is ./dist/src\n\n" +
                "       src=[directory path]   this will set the src directory to the given string.\n                              the default is ./lib");
            process.exit();
            break;
    }
}
var q = [];
var fs_read_options = {withFileTypes:true};
var html_minify_options = {collapseWhitespace: true, caseSensitive: true, removeComments: true};


//program entry
read_dir(dist_dir).then(bfs).catch(error);



//function definitions

/**
 * this function will scan a directory and return
 * a promise that resolves to an object o
 * where o.source is the absolute path to the directory
 * and o.files is an array of files and sub-directories in
 * the directory.
 */
function read_dir(dir){
    return new Promise((resolve, reject)=>{
        if(verbose)
            console.log("scanning directory: " + dir);
        fs.readdir(dir, fs_read_options, (err, files)=>{
            if(err)
                reject(err);
            if(files)
                resolve({source: dir, files: files});
        });
    });
}

/**
 * reads a file with the given absolute path and returns the utf8 string
 * @param file  the absoulte path of the file that needs to be read.
 * @returns  Promise  resolves to the utf8 string from the file, or rejects with and error from fs.readFile
 */
function read_file(file)
{
    return new Promise((resolve, reject) => {
        fs.readFile(file, 'utf8', (err, data)=>{
            if(err)
            {
                reject(err);
                return;
            }
            resolve(data);
        });
    });
}

function write_file(args)
{
    //save the file and make sure the next promise waits for the process to finish
    return new Promise((resolve, reject)=>{
        if(verbose)
            console.log("writing file: " +  args.file);
        fs.writeFile(args.file, args.data, (error)=>{
            if(error) console.error(`failed to save ${file}`);
            resolve();
        });
    });
}

/**
 * this function will search through the component javascript file
 * and find all references to TemplateUrl and StyleUrls and relace
 * the relative file path with inline minified sources.
 */
function replace_assets(file)
{
    var src_file = file.replace(dist_dir, src_dir);
    if(verbose)
        console.log('checking for resource Urls in: ' + file);

    return read_file(file).then((data) => {

        var html_catcher = /templateUrl\W*:\W*['"`](.*)['"`]/g;
        var scss_catcher = /styleUrls\W*:\W*\[(.*)+\]/g;
        var scss_catcher2 = /['"`]([^'"`]*)['"`]/g;
        var match, match2;
        var promises = [];
        var temp;
        //looks for templateUrl in the component file so it can replace it with template
        while(match = html_catcher.exec(data))
        {
            try
            {
                temp = path.resolve(src_file, "..", match[1]);
                promises.push(minify_html(temp))
            }
            catch(e)
            {
                console.error("failed to minify file" + match[1]);
            }
        }
        //looks for styleUrls in the component file is it can replace with inline css
        while(match = scss_catcher.exec(data))
        {
            try
            {
                while(match2 = scss_catcher2.exec(match[1]))
                {
                    temp = path.resolve(src_file, '..', match2[1]);
                    promises.push(minify_css(temp));
                }
            }
            catch(e)
            {
                console.error('failed to minify file' + match[1]);
            }
        }
        //returns a promise that waits for all minified resources to be computed then subs all the strings back
        //into the original file text and writes the file to disk overwriting the original js file.
        if(promises.length > 0)
        {
            return Promise.all(promises).then((minified)=>{
                //got through all the responses and replace the urls with the new inline resource strings
                console.log("inserting resources in: " + file);
                for(var i = 0; i < minified.length; i++)
                {
                    var name = minified[i].name.replace(path.resolve(src_file, '..'), '');
                    //making it safe to place the string inside ' in the string that will be printed to the file.
                    minified[i].data = minified[i].data.replace(/'/g, '\\\'');
                    if(name.endsWith('html'))
                        data = data.replace(new RegExp(`templateUrl\\W*:\\W*['"\`]\\.?/?${name}['"\`]`), `template:  '${minified[i].data}'`);
                    else
                    {
                        data = data.replace('styleUrls', 'styles');
                        data = data.replace(new RegExp('\\.?/?' + name), minified[i].data);
                    }
                }
                return {file: file, data: data};
            }).then(write_file);
        }
    });
}

/**
 * reads an html file, minifies the contents,
 * then returns an object {name: file, data: *minified string*}
 * @param  file   the string of the absoulte path to the html file to be minified
 * @returns Object {name: *String absoulte name of the file minified*, data: *the minified html string*}
 */
function minify_html(file)
{
    return read_file(file)
        .then((text)=>{
            return {name: file, data: html_minify(text, html_minify_options)};
        });
}

/**
 * reads an scss file, compiles it to css
 * @param  file    the string of the absolute path to the scss file to be compiled and minified
 * @return Promise resolves to the resulting css string or rejects with an error from the sass compiler.
 */
function compile_scss(file)
{
    return new Promise((resolve, reject)=>{
        sass.render({file: file}, (err, result)=>{
            if(err)
            {
                reject(err);
                return;
            }
            resolve(result.css.toString());
        })
    });
}

/**
 * reads an scss file, compiles it to css then minifies the contents.
 * returns an object {name: file, data: *minified string*}
 * @param  file   the string of the absolute path to the scss file to be compiled and minified
 * @return Object {name: *String absoulte name of the file minified*, data: *the minified css string*}
 */
function minify_css(file)
{
    var css_promise;
    if(file.endsWith('\.scss'))
    {
        css_promise = compile_scss(file);
    }
    else if(file.endsWith('\.css'))
    {
        css_promise = read_file(file);
    }
    return css_promise.then((css)=>{
        return cleancss.minify(css)
        .then((res) =>{
            return {name: file, data: res.styles};
        });
    })
}

/**
 * basic breadth first search through the file system starting at "state"
 * @param state an object with .files being an array containing the relative path to all files and subdirectories
 *              in this directory and .source being the absolute path to the current directory
 * @returns Promise  resolves undefined on success and rejects with an error on failure
 */
function bfs(state)
{
    var files = state.files;
    var source = state.source;
    var promises = [];
    var ans;
    //handle all files and subdirectories in this directory
    for(var i = 0; i < files.length; i++)
    {
        //if its a directory add it to the queue for bfs
        if(files[i].isDirectory())
        {
            q.push(path.resolve(source, files[i].name));
        }
        //if its a component file then read it and swap the assets in
        else if(files[i].isFile() && files[i].name && files[i].name.match(/^.*component.[jt]s$/))
        {
            promises.push(replace_assets(path.resolve(source, files[i].name)));
        }
    }
    ans = Promise.all(promises);
    //recursive call to the next directory in the queue
    if(q.length > 0)
    {
        dir = q.shift();
        if(verbose)
            console.log("continuing with directory: " + dir);
        //finish all asset replacements then move on to the next directory
        //this is to try and limit the amount of files loaded into memory at one time
        ans = ans.then(()=>{return read_dir(dir).then(bfs)});
    }
    return ans;
}

/**
 * basic error handler just writes to stderr
 */
function error(error)
{
    console.error(error);
    process.exit(-1);
}