# iOS Reverse Engineering Tutorial

Reversing iOS applications requires a jailbroken iOS device, for this example I will be using an iPhone 6s which runs iOS 13 and reverse engineering the Telegram application. The goal of this tutorial will be to change the contents of any message to a censor string. This tutorial will cover setting up an iOS reverse engineering environment, static & dynamic analysis of iOS binaries, and creating hooks to manipulate data as it flows within the application. 

## Benefits of iOS Reverse Engineering over Android

Reverse engineering iOS applications involves extracting IPA files instead of the APK files which contain Android applications. While there is a higher barrier to entry when reversing IPA files, less obfuscation techinques have been applied to IPA files. When reverse engineering Android applications a security researcher is unable to know the original names of classes, methods, and variables; whereas when reverse engineering iOS applications all of the original names are provided.

iOS does implement at rest encryption of their IPA files, only allowing the root user of the device to decrypt these at run-time. Luckily we will see that there are tools for gaining access to the root user and manually decrypting and extracting the application.

<p align="center">
  <img height="500" src="/images/image_1.png">
</p>

## Initial Setup and Configuration

Working with an iOS device requires privileged access to the shell, this requires the phone to be jailbroken (for iPhones below X the CheckRa1n jailbreak found [here](https://checkra.in) can be used). Additionally we must have access to the shell, SSH is the method we will be using for accessing the device's shell. The rest of the tutorial will be written assuming the device is jailbroken with CheckRa1n and that Cydia package manager is installed.

To begin we will set up an iOS device for SSH so we are able to get access to the shell. From this shell we will be able to execute commands which are used to extract, hook, and manipulate applications. 

Navigate to Cydia on the iOS device and search for the “OpenSSH” package. Once this has been installed you will be able to ssh to the device with the username “root” using the default password of “alpine”. Installing packages with Cydia is a common theme in this tutorial, as we see later on we’ll be adding additional sources and installing packages for various different reasons. 

## Static Reverse Engineering IPA files

IPA files are the binaries installed when an app is installed on an iOS device. These binaries are encrypted at rest and thus they must be run to extract their decrypted versions. Luckily there are tools such as “Clutch” which will extract the binaries in their decrypted form.

### Extracting IPA files using Clutch

Clutch is self described as a “high-speed iOS decryption tool” and will decrypt the binaries for any app/bundle that we ask. In this instance we will be asking Clutch to decrypt and package the Telegram application for extraction. If you haven't yet installed the Telegram application on your device from the App Store do so now.

First you must have a jailbroken iOS device with Cydia installed. Under Cydia sources add the source “http://cydia.radare.org/”. Once this source has been added you can then search for and install the “Clutch” package. Note that this should be version 2.0+.

Once Clutch has been installed, open a shell on the iOS device. From the shell enter the command `Clutch` and a list of all apps with their corresponding index (a.k.a bundle ID) will be displayed.

<p align="center">
  <img src="/images/image_2.png">

<p align="center">Image 1. Results from running Clutch on an iOS device</p>
</p>


Once the bundle ID for the application you would like to extract has been found, extract the IPA file using `Clutch -d <bundle ID>`, for this example the command would be `Clutch -d 4`. 
Running the Clutch command will create a directory under “/var/tmp/clutch” with the Applications UUID as the directories name, this directory will contain all the binary files used for static analysis.

<p align="center">
  <img src="/images/image_3.png">

<p align="center">Image 2. UUID directory containing all the Mach O files for Telegram</p>
</p>

These files should be extracted from the iOS device using the following method:
1. Compress the files using `tar -czvf binaries.tar.gz <UUID of directory>/`
1. Extract with `scp root@<iOS device IP addr>:/var/tmp/clutch/binaries.tar.gz .`
1. Decompress with `tar -xvzf binaries.tar.gz`

These files are of the Mach object file format and can be processed by static analysis tools such as Ghidra or IDA pro. Additionally we will be using the class-dump tool to analyze these binaries to retrieve the unobfuscated class objects after we determine which classes to hook.

### Generating Classes with class-dump

The class-dump tool lets us generate the headers files from each binary extracted by Clutch. These headers contain the unobfuscated names of classes, methods, and class variables. By grepping over the files with the command `grep "@interface" ./*` we can print all the Classes extracted from the binaries.

For this example we will be looking for classes pertaining to messages, so we will begin by searching for these classes by running `grep "@interface" ./* | grep Message` on all the files within the __classes__ directory contained in this repo (it contains the output of class-dump for all binaries extracted by Clutch).

Out of the classes that have been found we should be particularly interested in the `MTOutgoingMessage` as a candidate for intercepting. Looking at the methods contained within the class we should attempt to reverse the `initWithData` method.

<p align="center">
  <img src="/images/image_7.png">

<p align="center">Image 2. MTOutgoingMessage class with class variables and methods</p>
</p>

## Dynamic Reverse Engineering with Frida

Static Reverse Engineering can only take us so far with finding the functions we’d like to manipulate when sending messages. Our first step in dynamic reverse engineering will be to find the functions called when sending messages. 

For this we will go back to Cydia and add the “https://build.frida.re/” source, which will provide the Frida package. Search for “Frida” and install the package. Once the package has been installed SSH to the iPhone using the default username “root” and password “alpine”. Run the command `frida-server -l <IP address of iPhone>` to initialize remote Frida instrumentation. This is only the first half of the Frida instrumentation setup. 
 
We will then install the frida-tools framework on a Debian based system, Ubuntu is suggested. Install the frida-tools by running `pip install frida-tools` and ensure that you are able to run `frida-ps --version` to confirm it has been installed.

Now that frida has been installed on the iOS device and the Debian system we can begin to search for functions related to app functionality. First we need to tell Frida which process to attach to for analysis, in order to find the process id or process name of Telegram we will run `frida-ps -H <IP address of iPhone> | grep Telegram` (Note that the `frida-ps -H <IP address of iPhone>` portion of the command will list all currently running processes).

For this example we want to intercept the `MTOutgoingMessage` class after it's been initialized, change the contents of the message to a censor string before it’s encrypted and forwarding the message to the end user.

### Function tracing with Frida

To begin we will execute the following commands using `frida-trace` which is used to dynamically trace function calls. We will do the following in quick succession:

1. Run `rida-trace -H <IP> Telegram -m "*[MTOutgoingMessage initWithData*]" `
1. Send a message in Telegram
1. Stop the `frida-trace` process

Once we have finished we will see that Frida has generated a `__handlers__/<function name>.js` files for each function it has found. The Javascript files will be executed each time the function is called and will execute `onEnter` and `onLeave` before and after execution respectively.

<p align="center">
  <img src="/images/image_8.png">
<p align="center">Image 3. Automatically generated Javascript file which logs function with parameters onEnter </p>
</p>

### Frida Javascript API 

Using the Frida Javascript API we can manipulate the class and the memory used to store the message prior to sending. Below is the javascript function which will change any message to a censor string.   

``` javascript
{
  onEnter: function (log, args, state) {

    //Ascii string encoded
    var flagString = [0x23, 0x24, 0x40, 0x26, 0x25, 0x2a, 0x21, 0x20]

    //Create objective C object using pointer from Argument 2
    var initData = new ObjC.Object(args[2]);

    //Extract bytes into an array
    var dataArray = new Uint8Array(Memory.readByteArray(initData.bytes(), initData.length()));

    //Byte value 0x70 corresponds to text message 
    if(dataArray[0] == 0x70){
    
      log("\n\n====== Found message object ======");

      //Read the bytes before writing to them to view original message.
      var dataBytes = Memory.readByteArray(initData.bytes(), initData.length());
      log("\nData before writing:\n" +hexdump(dataBytes, {offset: 0, length: initData.length(), header: true, ansi: false}));
 
      // Determine length of message by checking byte 0x18 of the message
      var i;
      for (i = 0x00; i < dataArray[0x18]; i++) {
        //Starting at 0x19, the first byte of the message, copy the flag string byte by byte.
        dataArray[0x19 + i] = flagString[i % flagString.length];
      } 
      
      //Write dataArray into the message object
      Memory.writeByteArray(initData.bytes(), dataArray);

      //Read the bytes after writing to them to confirm working.
      var dataBytes = Memory.readByteArray(initData.bytes(), initData.length());
      log("\nData after writing:\n" +hexdump(dataBytes, {offset: 0, length: initData.length(), header: true, ansi: false}));
    }
  },
}
```

The Frida API function calls used above which are of note are:
* `ObjC.Object(`
  * This function is used to tell Frida to process the argument as an Objective-C Object, read more [here](https://frida.re/docs/examples/ios/)
  
* `Memory.readByteArray(`
  * Read a byte array from memory.
  
* `Memory.writeByteArray(`
  * Write a byte array into memory.

Portions of the code which are used for logical flows were determined from analysing the hexdump, explainations follow:
* `dataArray[0] == 0x70`
  * It was determined that message objects which we would like to change are started with the `0x70` tag.

* `i < dataArray[0x18]`
  * It was determined that the byte in the 24th (0x18) position is the length of the message.

* `dataArray[0x19 + i] = flagString[i % flagString.length]`
  * It was determined that the byte in the 25th (0x19) position is start of the ascii encoded message which continue for the messages length determined from byte 24.

## Tips and Tricks

When reverse engineering iOS applications there are a lot of resources out there, the following are links to resources I found useful:


* <b>Jailbreak</b>
  * [CheckRa1n Jailbreak](https://checkra.in/)
  * [Apples statement on Jailbreaking](https://support.apple.com/en-us/HT201954)

* <b>Tools</b>
  * [class-dump](http://stevenygard.com/projects/class-dump/)
  * [Clutch](https://github.com/KJCracks/Clutch)

* <b>Frida</b>
  * [Frida API for iOS](https://frida.re/docs/examples/ios/)
  * [Frida API for Memory management](https://frida.re/docs/javascript-api/#memory)
  * [Frida iOS installation instructions](https://frida.re/docs/ios/)
  * [Frida tools installation instructions](https://frida.re/docs/installation/)
 
The following are useful pieces of information:

* Hexdumps are your best friend, the following chunk of code can be used to dump the bytes of the object stored in args[2]

  ``` javascript
  var objectData = new ObjC.Object(args[2]);
  var objectBytes = Memory.readByteArray(objectData.bytes(), objectData.length());`
  log("\Object Hexdump:\n" +hexdump(objectBytes, {offset: 0, length: objectData.length(), header: true, ansi: false}));
  ```

## Conclusion

Hopefully this has helped you learn about iOS reverse engineering. This is just an introduction, there is quite a bit more to learn and create, good luck!

<p align="center">
  <img src="/images/image_9.png">
</p>
