// JSX typing for PayPal JS SDK v6 web components (the package only types the DOM side).
import type { DetailedHTMLProps, HTMLAttributes } from "react";

type PayPalButtonProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  type?: "buynow" | "checkout" | "donate" | "pay" | "subscribe";
  disabled?: boolean;
  class?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": PayPalButtonProps;
    }
  }
}
