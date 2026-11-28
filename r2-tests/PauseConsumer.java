import com.sun.jdi.*;
import com.sun.jdi.connect.AttachingConnector;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;


// Attach only to the loopback debug port of a child JVM created by recovery.mjs.
class PauseConsumer {
  public static void main(String[] args) throws Exception {
    int line = Integer.parseInt(args[1]);
    AttachingConnector connector = Bootstrap.virtualMachineManager().attachingConnectors().stream()
        .filter(c -> c.name().equals("com.sun.jdi.SocketAttach")).findFirst().orElseThrow();
    var config = connector.defaultArguments();
    config.get("hostname").setValue("127.0.0.1");
    config.get("port").setValue(args[0]);
    var vm = connector.attach(config);
    try {
      var queue = vm.classesByName("local.review.AnalysisQueue").getFirst();
      var points = queue.locationsOfLine(line);
      if (points.isEmpty()) throw new IllegalArgumentException("无调试行号 " + line);
      for (var location : points) {
        var bp = vm.eventRequestManager().createBreakpointRequest(location);
        bp.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
        bp.enable();
      }
      System.out.println("READY");
      while (true) {
        EventSet events = vm.eventQueue().remove();
        for (var event : events) {
          if (!(event instanceof BreakpointEvent hit)) continue;
          var id = (StringReference)hit.thread().frame(0).getArgumentValues().getFirst();
          if (args.length > 2 && !args[2].equals(id.value())) continue;
          System.out.println("PAUSED " + id.value());
          int command = System.in.read();
          if (command == 'K') vm.exit(33);
          if (command == 'S') {
            vm.eventRequestManager().deleteAllBreakpoints();
            var finished = vm.eventRequestManager().createMethodExitRequest();
            finished.addClassFilter("local.review.AnalysisQueue");
            finished.addThreadFilter(hit.thread());
            finished.enable();
            events.resume();
            while (true) {
              var exits = vm.eventQueue().remove();
              for (var next : exits) {
                if (next instanceof MethodExitEvent done && done.method().name().equals("execute")) {
                  System.out.println("FINISHED");
                  return;
                }
              }
              exits.resume();
            }
          }
          return;
        }
        events.resume();
      }
    } finally {
      try { vm.dispose(); } catch (VMDisconnectedException ignored) {}
    }
  }
}
