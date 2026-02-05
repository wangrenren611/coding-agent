import { useState, forwardRef } from "react";
import { COLORS } from "../../theme";

interface TextInputProps {
  disabled?: boolean;
  placeholder?: string;
}

export interface TextInputRef {
  submit: () => void;
  getValue: () => string;
  clear: () => void;
}

const TextInput = forwardRef<TextInputRef, TextInputProps>(({ disabled = false, placeholder = "Type a message..." }, ref) => {
  const [value, setValue] = useState('');


  return (
    <box
      flexDirection="row"
      alignItems="center"
      borderColor={disabled ? COLORS.muted : '#999'}
      border={true}
      height={5}
      width={'100%'}
      paddingLeft={1}
      paddingRight={1}
      overflow="scroll"
    >
      <textarea
        height={'100%'}
        width={'100%'}
        placeholder={placeholder}
        textColor={disabled ? COLORS.muted : '#fff'}
        focused={!disabled}
      />
    </box>
  );
});

TextInput.displayName = 'TextInput';

export default TextInput;
