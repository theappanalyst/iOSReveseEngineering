{
  onEnter: function (log, args, state) {

    //"Flag captured " encoded as ascii hex values
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
